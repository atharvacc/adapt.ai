import linkedinSvg from '../assets/platforms/linkedin.svg'
import xSvg from '../assets/platforms/x.svg'
import instagramSvg from '../assets/platforms/instagram.svg'
import tiktokSvg from '../assets/platforms/tiktok.svg'
import type { Platform } from '../types'

const ICONS: Record<Platform, string> = {
  linkedin: linkedinSvg,
  x: xSvg,
  instagram: instagramSvg,
  tiktok: tiktokSvg,
}

const PLATFORM_LABELS: Record<Platform, string> = {
  linkedin: 'LinkedIn',
  x: 'X / Twitter',
  instagram: 'Instagram',
  tiktok: 'TikTok',
}

const PLATFORM_COLORS: Record<Platform, string> = {
  linkedin: '#0A66C2',
  x: '#000000',
  instagram: '#E4405F',
  tiktok: '#000000',
}

export function PlatformIcon({
  platform,
  size = 20,
  className = '',
}: {
  platform: Platform
  size?: number
  className?: string
}) {
  return (
    <img
      src={ICONS[platform]}
      alt={PLATFORM_LABELS[platform]}
      width={size}
      height={size}
      className={className}
    />
  )
}

export { PLATFORM_LABELS, PLATFORM_COLORS }
