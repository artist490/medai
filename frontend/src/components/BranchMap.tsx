// Векторная карта филиала, отрисованная с нуля в палитре «Клинического света».
// MapLibre GL читает наши PMTiles-экстракты (/maps/{slug}.pmtiles, вырезаются
// из билда Protomaps) — во внешние сервисы страница не ходит, offline-деплой.
//
// Проекция — globe: при отдалении карта становится земным шаром, а не плоским
// полотном. Городские экстракты покрывают только свой bbox, поэтому для низких
// зумов рядом лежит мировая суша (world-atlas 110m, /world/*.geojson):
// она проявляется при отдалении и гаснет к городскому зуму.
import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, Marker, NavigationControl, ScaleControl, addProtocol, setWorkerUrl, type StyleSpecification, type RequestParameters } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
// Воркер MapLibre — явный URL для Vite (иначе «Worker failed to load» в сборке)
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
setWorkerUrl(maplibreWorkerUrl)

// PMTiles-протокол регистрируется один раз на модуль
const protocol = new Protocol()
addProtocol('pmtiles', (params: RequestParameters, abortController: AbortController) =>
  protocol.tile(params, abortController) as unknown as Promise<{ data: ArrayBuffer }>,
)

// Зумы, между которыми происходит переход «глобус ↔ город».
// До WORLD_FADE_END видна мировая суша, с CITY_MIN_ZOOM — городские тайлы.
const WORLD_FADE_END = 8.5
const CITY_MIN_ZOOM = 8
// Диаметр шара в пикселях на зуме 0: worldSize / (π·cos φ), где worldSize = 512.
// Формула из исходников MapLibre (getGlobeRadiusPixels), а не подбор «на глаз»:
// иначе шар не вписывается в контейнер и висит мелким пятном по центру.
const WORLD_TILE_PX = 512

/** Зум, при котором земной шар занимает долю высоты контейнера. */
function fitGlobeZoom(height: number, lat: number): number {
  const target = Math.max(160, height * 0.92)
  const cos = Math.cos((Math.min(Math.abs(lat), 85) * Math.PI) / 180)
  return Math.log2((target * Math.PI * cos) / WORLD_TILE_PX)
}

const PIN_HTML =
  '<style>@keyframes bmpulse{0%{transform:scale(.5);opacity:.85}100%{transform:scale(2);opacity:0}}</style>' +
  '<div style="position:relative;width:26px;height:34px">' +
  '<div style="position:absolute;left:-8px;top:-8px;width:26px;height:26px;border-radius:50%;' +
  'background:rgba(11,92,88,.35);animation:bmpulse 1.8s ease-out infinite"></div>' +
  '<div style="position:absolute;left:0;top:0;width:26px;height:26px;background:#0b5c58;' +
  'border:2px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
  'box-shadow:0 6px 14px rgba(11,60,56,.35)"></div>' +
  '<div style="position:absolute;left:9px;top:8px;width:8px;height:8px;background:#fff;border-radius:50%"></div></div>'

// Меридианы и параллели: на глобусе дают масштаб и «картографичность».
// Рисуются под сушей, поэтому видны только над океаном — как на морской карте.
function graticule(step = 30): GeoJSON.FeatureCollection {  const features: GeoJSON.Feature[] = []
  const line = (coords: number[][]) => ({
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: coords },
  })
  for (let lon = -180; lon <= 180; lon += step) {
    const coords: number[][] = []
    for (let lat = -85; lat <= 85; lat += 5) coords.push([lon, lat])
    features.push(line(coords))
  }
  for (let lat = -60; lat <= 60; lat += step) {
    const coords: number[][] = []
    for (let lon = -180; lon <= 180; lon += 5) coords.push([lon, lat])
    features.push(line(coords))
  }
  return { type: 'FeatureCollection', features }
}

// Иконки POI рисуются канвасом (без спрайт-листов): белый круг + цветной крест
function makeIconImage(color: string): ImageData {
  const c = document.createElement('canvas')
  c.width = c.height = 48
  const ctx = c.getContext('2d')!
  ctx.beginPath(); ctx.arc(24, 24, 21, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'; ctx.fill()
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(11,60,56,.16)'; ctx.stroke()
  ctx.fillStyle = color
  ctx.lineCap = 'round'; ctx.lineWidth = 9
  ctx.beginPath(); ctx.moveTo(24, 14); ctx.lineTo(24, 34); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(14, 24); ctx.lineTo(34, 24); ctx.stroke()
  return ctx.getImageData(0, 0, 48, 48)
}

// Иконки живут в стиле; после setStyle их нужно вернуть
function addMapImages(map: MapLibreMap) {
  if (map.hasImage('med-cross')) return
  map.addImage('med-cross', makeIconImage('#0b5c58'), { pixelRatio: 2 })
  map.addImage('pharmacy', makeIconImage('#2E7D4F'), { pixelRatio: 2 })
}

// Стиль «Клинический свет» — вся геометрия красится в палитру сайта.
// Порядок слоёв снизу вверх: океан → сетка → суша → границы → город.
function buildStyle(slug: string, threeD: boolean): StyleSpecification {
  const kind = ['coalesce', ['get', 'kind'], ['get', 'pmap:kind']]
  return {
    version: 8,
    glyphs: '/glyphs/{fontstack}/{range}.pbf',
    // Глобус вместо плоского полотна: при отдалении земля становится шаром
    projection: { type: 'globe' },
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles:///maps/${slug}.pmtiles`,
        // Ниже CITY_MIN_ZOOM городские тайлы не запрашиваются: на глобусе
        // они дали бы крошечное пятно детализации поверх мировой суши
        minzoom: CITY_MIN_ZOOM,
        maxzoom: 15,
        attribution: '© OpenStreetMap contributors · Protomaps',
      },
      // Мировая суша и границы: нужны только на низких зумах, где городских
      // тайлов нет. 110m-генерализация — 84 и 188 КБ, грузятся один раз.
      worldLand: {
        type: 'geojson',
        data: '/world/land-110m.geojson',
        attribution: 'Natural Earth',
      },
      worldBorders: {
        type: 'geojson',
        data: '/world/countries-110m.geojson',
      },
      graticule: {
        type: 'geojson',
        data: graticule(),
      },
    },
    layers: [
      {
        id: 'bg', type: 'background',
        // Океан на глобусе заметно глубже бумаги сайта — иначе шар читается
        // как бледное пятно; к городскому зуму фон светлеет до бумаги.
        paint: {
          'background-color': ['interpolate', ['linear'], ['zoom'],
            0, '#B7D5CE',
            3, '#C6DED8',
            6, '#E2EEEB',
            8.5, '#F7FAF8'],
        },
      },

      // Сетка видна только над водой: суша рисуется поверх
      {
        id: 'graticule', type: 'line', source: 'graticule',
        paint: {
          'line-color': '#9FBEB6',
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 4, 1],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 5.5, 0],
        },
      },

      // Суша: проявляется при отдалении и гаснет до городского зума
      {
        id: 'world-land', type: 'fill', source: 'worldLand',
        paint: {
          'fill-color': '#F4F8F6',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'],
            0, 1, 5, 1, WORLD_FADE_END, 0],
        },
      },
      {
        id: 'world-borders', type: 'line', source: 'worldBorders',
        paint: {
          'line-color': '#BCD4CD',
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 5, 0.9],
          'line-opacity': ['interpolate', ['linear'], ['zoom'],
            0, 0.95, 5, 0.95, WORLD_FADE_END, 0],
        },
      },

      // Зелень и парки
      {
        id: 'landuse-green', type: 'fill', source: 'protomaps', 'source-layer': 'landuse',
        filter: ['==', kind, 'green'],
        paint: { 'fill-color': '#E3EFE9', 'fill-opacity': 0.9 },
      },

      // Территории больниц и клиник — тил-подсветка
      {
        id: 'landuse-healthcare', type: 'fill', source: 'protomaps', 'source-layer': 'landuse',
        filter: ['==', kind, 'healthcare'],
        paint: { 'fill-color': '#E7F2EF' },
      },

      // Вода
      {
        id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water',
        paint: { 'fill-color': '#C9E4DF' },
      },

      // Городская черта — тонкий пунктир
      {
        id: 'boundaries-city', type: 'line', source: 'protomaps', 'source-layer': 'boundaries',
        minzoom: 11,
        filter: ['in', kind, ['literal', ['city', 'settlement']]],
        paint: { 'line-color': '#d9e2df', 'line-width': 1, 'line-dasharray': [2, 2] },
      },

      // Casing под магистралями — контраст основных дорог
      {
        id: 'roads-casing', type: 'line', source: 'protomaps', 'source-layer': 'roads',
        filter: ['in', kind, ['literal', ['major_road', 'highway']]],
        paint: { 'line-color': '#F7FAF8', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.6, 15, 6] },
      },

      {
        id: 'roads-minor', type: 'line', source: 'protomaps', 'source-layer': 'roads',
        filter: ['in', kind, ['literal', ['minor_road']]],
        paint: { 'line-color': '#D8E2DF', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 3.4] },
      },
      {
        id: 'roads-major', type: 'line', source: 'protomaps', 'source-layer': 'roads',
        filter: ['==', kind, 'major_road'],
        paint: { 'line-color': '#C2D1CD', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 15, 4.4] },
      },
      {
        id: 'roads-highway', type: 'line', source: 'protomaps', 'source-layer': 'roads',
        filter: ['==', kind, 'highway'],
        paint: { 'line-color': '#9FCFC5', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.4, 15, 5] },
      },
      {
        id: 'rail', type: 'line', source: 'protomaps', 'source-layer': 'roads',
        filter: ['==', kind, 'rail'],
        paint: { 'line-color': '#D7DFDC', 'line-width': 0.8 },
      },

      // Здания: 2D — плоские двухтональные кварталы, 3D — объёмные по высотам OSM
      {
        id: 'buildings-flat', type: 'fill', source: 'protomaps', 'source-layer': 'buildings',
        minzoom: 13,
        layout: { visibility: threeD ? 'none' : 'visible' },
        paint: {
          'fill-color': ['match', ['get', 'kind_detail'], 'residential', '#EAEFEA', '#E2EAE7'],
          'fill-outline-color': '#DFE7E4',
        },
      },
      {
        id: 'buildings-3d', type: 'fill-extrusion', source: 'protomaps', 'source-layer': 'buildings',
        minzoom: 13,
        layout: { visibility: threeD ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'],
            ['coalesce', ['get', 'height'], ['match', ['get', 'kind_detail'], 'office', 15, 'apartments', 13, 9]],
            8, '#CFE0DB', 25, '#A9CFC5', 60, '#8FC2B8',
          ],
          'fill-extrusion-height': [
            '*', 3, [
              'coalesce', ['get', 'height'],
              ['match', ['get', 'kind_detail'],
                'apartments', 13, 'residential', 9, 'commercial', 11,
                'retail', 7, 'industrial', 6, 'office', 15, 'hotel', 16, 8],
            ],
          ],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 1,
        },
      },
      {
        id: 'roads-path', type: 'line', source: 'protomaps', 'source-layer': 'roads',
        filter: ['==', kind, 'path'],
        paint: { 'line-color': '#DFE7E4', 'line-width': 1, 'line-dasharray': [1.5, 1.5] },
      },

      // Медицинские POI: клиники/больницы — тил-крест, аптеки — зелёный
      {
        id: 'pois-health', type: 'symbol', source: 'protomaps', 'source-layer': 'pois',
        minzoom: 12,
        filter: ['in', kind, ['literal', ['hospital', 'clinic', 'doctors', 'pharmacy']]],
        layout: {
          'icon-image': ['match', kind, 'pharmacy', 'pharmacy', 'med-cross'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 15, 1.05],
          'text-field': ['get', 'name'],
          'text-font': ['literal', ['Noto Sans Regular']],
          'text-size': 9.5,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
        },
        paint: { 'text-color': '#3e4f4b', 'text-halo-color': '#F7FAF8', 'text-halo-width': 1.3 },
      },

      // Подписи: районы, улицы, вода (глифы Noto Sans — локальные)
      {
        id: 'labels-places', type: 'symbol', source: 'protomaps', 'source-layer': 'places',
        minzoom: 13,
        filter: ['in', kind, ['literal', ['neighbourhood', 'suburb', 'quarter', 'city_district']]],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['literal', ['Noto Sans Bold']],
          'text-size': 11.5,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.06,
        },
        paint: { 'text-color': '#475855', 'text-halo-color': '#F7FAF8', 'text-halo-width': 1.4 },
      },
      {
        id: 'labels-streets', type: 'symbol', source: 'protomaps', 'source-layer': 'roads',
        minzoom: 14,
        filter: ['all', ['has', 'name'], ['==', kind, 'minor_road']],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['literal', ['Noto Sans Regular']],
          'text-size': 10.5,
          'symbol-placement': 'line',
        },
        paint: { 'text-color': '#3e4f4b', 'text-halo-color': '#F7FAF8', 'text-halo-width': 1.5 },
      },
      {
        id: 'labels-water', type: 'symbol', source: 'protomaps', 'source-layer': 'water',
        minzoom: 12,
        filter: ['has', 'name'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['literal', ['Noto Sans Regular']],
          'text-size': 11,
        },
        paint: { 'text-color': '#3e8a80', 'text-halo-color': '#F7FAF8', 'text-halo-width': 1.2 },
      },
    ],
  } as StyleSpecification
}

export default function BranchMap({ slug, lat, lon }: {
  slug: string
  lat: number
  lon: number
  city: string
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const clinicRef = useRef<[number, number]>([lat, lon])
  const [threeD, setThreeD] = useState(false)
  const threeDRef = useRef(false)
  const dimBtnRef = useRef<HTMLButtonElement | null>(null)

  // Карта создаётся один раз на время жизни компонента
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return
    const pin = document.createElement('div')
    pin.innerHTML = PIN_HTML

    const map = new MapLibreMap({
      container: boxRef.current,
      style: buildStyle(slug, threeD),
      center: [lon, lat],
      zoom: 14, // на 14 появляются подписи улиц
      minZoom: -1, // дальше шар переворачивается через полюс
      maxZoom: 15,
      scrollZoom: false, // не перехватывать скролл страницы
    })
    map.addControl(new NavigationControl({ showCompass: true }), 'top-left')
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')

    // Кнопка «Глобус»: камера уезжает к земному шару и обратно
    const globeBtn = document.createElement('div')
    globeBtn.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    globeBtn.innerHTML =
      '<button type="button" title="Показать земной шар" aria-label="Показать земной шар" ' +
      'style="width:29px;height:29px;display:grid;place-items:center;border:0;background:none;cursor:pointer;color:var(--color-teal-deep)">' +
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round"><circle cx="12" cy="12" r="8.5"></circle>' +
      '<path d="M3.5 12h17M12 3.5c2.6 2.4 4 5.3 4 8.5s-1.4 6.1-4 8.5c-2.6-2.4-4-5.3-4-8.5s1.4-6.1 4-8.5z"></path></svg></button>'
    globeBtn.querySelector('button')!.addEventListener('click', () => {
      const [la, lo] = clinicRef.current
      const toGlobe = map.getZoom() > 6
      map.easeTo({
        center: [lo, la],
        zoom: toGlobe ? fitGlobeZoom(map.getContainer().clientHeight, la) : 14,
        pitch: 0,
        bearing: 0,
        duration: 1400,
        easing: (t) => 1 - Math.pow(1 - t, 3),
      })
    })
    map.addControl({ onAdd: () => globeBtn, onRemove: () => { globeBtn.remove() } }, 'top-left')

    // Кнопка «Клиника»: вернуть камеру к пину филиала
    const clinicBtn = document.createElement('div')
    clinicBtn.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    clinicBtn.innerHTML =
      '<button type="button" title="Показать клинику" aria-label="Показать клинику" ' +
      'style="width:29px;height:29px;display:grid;place-items:center;border:0;background:none;cursor:pointer;color:var(--color-teal-deep)">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"></path></svg></button>'
    clinicBtn.querySelector('button')!.addEventListener('click', () => {
      const [la, lo] = clinicRef.current
      // мягкий перелёт вместо jumpTo
      map.easeTo({ center: [lo, la], zoom: 14, duration: 800, easing: (t) => 1 - Math.pow(1 - t, 3) })
    })
    map.addControl({ onAdd: () => clinicBtn, onRemove: () => { clinicBtn.remove() } }, 'top-left')

    // Кнопка 2D/3D: наклон камеры + объёмные здания
    const dimBtn = document.createElement('div')
    dimBtn.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    dimBtn.innerHTML =
      '<button type="button" title="Переключить 2D/3D" aria-label="Переключить 2D/3D" ' +
      'style="width:29px;height:29px;display:grid;place-items:center;border:0;background:none;cursor:pointer;' +
      'color:var(--color-teal-deep);font-size:11px;font-weight:800;font-family:Inter,system-ui,sans-serif">3D</button>'
    dimBtn.querySelector('button')!.addEventListener('click', () => setThreeD((v) => !v))
    dimBtnRef.current = dimBtn.querySelector('button')
    map.addControl({ onAdd: () => dimBtn, onRemove: () => { dimBtn.remove() } }, 'top-left')

    markerRef.current = new Marker({ element: pin })
      .setLngLat([lon, lat])
      .addTo(map)
    mapRef.current = map
    try {
      // Атмосфера глобуса: светлая, чтобы шар жил в бумажной палитре сайта,
      // а не выглядел скриншотом Google Earth
      map.setSky({
        'sky-color': '#F4F9F7',
        'horizon-color': '#D8E9E4',
        'fog-color': '#EDF4F1',
        'sky-horizon-blend': 0.7,
        'horizon-fog-blend': 0.6,
        'fog-ground-blend': 0.4,
      })
    } catch { /* Sky API недоступна */ }
    map.on('load', () => {
      addMapImages(map)
      // если 3D включили до загрузки стиля — применяем слои зданий здесь
      if (threeDRef.current && map.getLayer('buildings-3d')) {
        map.setLayoutProperty('buildings-flat', 'visibility', 'none')
        map.setLayoutProperty('buildings-3d', 'visibility', 'visible')
      }
    })

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Режим 2D/3D: наклон камеры + прямое переключение слоёв зданий.
  // Раньше менялась только камера — над плоскими крышами «3D» выглядел
  // сломанным; объём появлялся лишь после смены филиала (пересборка стиля).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    threeDRef.current = threeD
    const setVis = (id: string, visible: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    }
    setVis('buildings-flat', !threeD)
    setVis('buildings-3d', threeD)
    map.easeTo({ pitch: threeD ? 52 : 0, bearing: threeD ? -22 : 0, duration: 700 })
    if (dimBtnRef.current) dimBtnRef.current.textContent = threeD ? '2D' : '3D'
  }, [threeD])

  // Смена филиала: стиль на другой PMTiles-экстракт + переезд
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    clinicRef.current = [lat, lon]
    map.setStyle(buildStyle(slug, threeD), { diff: false })
    map.once('style.load', () => addMapImages(map))
    map.jumpTo({ center: [lon, lat], zoom: 14, pitch: threeD ? 52 : 0, bearing: threeD ? -22 : 0 })
    markerRef.current?.setLngLat([lon, lat])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, lat, lon])

  // Эргономичный формат ~16:10 (вместо растянутой полосы), одинаковый
  // в 2D и 3D — при переключении камера наклоняется внутри той же рамки
  return (
    <div>
      <div
        ref={boxRef}
        className="w-full h-[260px] lg:h-[340px]"
        style={{ background: '#F7FAF8' }}
      />
      {/* Подпись под картой: иконка глобуса без неё не читается */}
      <p className="mt-2 text-[10.5px] text-ink-soft">
        Отдалите карту или нажмите глобус — увидите, где филиал на планете.
      </p>
    </div>
  )
}
