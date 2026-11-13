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
import cross from '../assets/icons/cross.png'
import check from '../assets/icons/check.png'
import alarm from '../assets/icons/alarm.png'
import trash from '../assets/icons/trash.png'
import bulb from '../assets/icons/bulb.png'
import run from '../assets/icons/run.png'
import salad from '../assets/icons/salad.png'
import clock from '../assets/icons/clock.png'
import lock from '../assets/icons/lock.png'
import wave from '../assets/icons/wave.png'
import rocket from '../assets/icons/rocket.png'
import sparkle from '../assets/icons/sparkle.png'
import party from '../assets/icons/party.png'
import male from '../assets/icons/male.png'
import female from '../assets/icons/female.png'
import care from '../assets/icons/care.png'

export type IconName =
  | 'home' | 'stethoscope' | 'chart' | 'profile'
  | 'search' | 'bell' | 'help'
  | 'pressure' | 'pulse' | 'temperature' | 'lungs'
  | 'scale' | 'sleep' | 'steps' | 'water'
  | 'robot' | 'warning'
  | 'cross' | 'check' | 'alarm' | 'trash'
  | 'bulb' | 'run' | 'salad' | 'clock'
  | 'lock' | 'wave' | 'rocket' | 'sparkle'
  | 'party' | 'male' | 'female' | 'care'

const sources: Record<IconName, string> = {
  home, stethoscope, chart, profile,
  search, bell, help,
  pressure, pulse, temperature, lungs,
  scale, sleep, steps, water,
  robot, warning,
  cross, check, alarm, trash,
  bulb, run, salad, clock,
  lock, wave, rocket, sparkle,
  party, male, female, care,
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
