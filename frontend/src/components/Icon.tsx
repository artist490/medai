// Единый компонент иконок (нарезаны из Recraft-набора, PNG с прозрачностью).
import home from '../assets/icons/home.png'
import stethoscope from '../assets/icons/stethoscope.png'
import chart from '../assets/icons/chart.png'
import profile from '../assets/icons/profile.png'
import search from '../assets/icons/search.png'
import bell from '../assets/icons/bell.png'
import help from '../assets/icons/help.png'
import pressure from '../assets/icons/pressure.png'
import pulse from '../assets/icons/pulse.png'
import temperature from '../assets/icons/temperature.png'
import lungs from '../assets/icons/lungs.png'
import scale from '../assets/icons/scale.png'
import sleep from '../assets/icons/sleep.png'
import steps from '../assets/icons/steps.png'
import water from '../assets/icons/water.png'
import robot from '../assets/icons/robot.png'
import warning from '../assets/icons/warning.png'

export type IconName =
  | 'home' | 'stethoscope' | 'chart' | 'profile'
  | 'search' | 'bell' | 'help'
  | 'pressure' | 'pulse' | 'temperature' | 'lungs'
  | 'scale' | 'sleep' | 'steps' | 'water'
  | 'robot' | 'warning'

const sources: Record<IconName, string> = {
  home, stethoscope, chart, profile,
  search, bell, help,
  pressure, pulse, temperature, lungs,
  scale, sleep, steps, water,
  robot, warning,
}

export function Icon({ name, size = 20, className }: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <img
      src={sources[name]}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className={`inline-block select-none ${className ?? ''}`}
      style={{ width: size, height: size, objectFit: 'contain', verticalAlign: 'middle' }}
    />
  )
}
