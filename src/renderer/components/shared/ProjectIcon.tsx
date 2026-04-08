interface ProjectIconProps {
  name: string
  emoji?: string
  color?: string
  size?: number
  fontSize?: number
}

function getInitials(name: string): string {
  if (!name?.trim()) return 'YP'
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export { getInitials }

export default function ProjectIcon({
  name,
  emoji,
  color = '#7c73e6',
  size = 36,
  fontSize,
}: ProjectIconProps) {
  const initials = getInitials(name)
  const isEmoji = !!emoji

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        background: isEmoji ? 'var(--surface)' : color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: fontSize || (isEmoji ? size * 0.48 : size * 0.35),
        fontWeight: 700,
        color: 'white',
        flexShrink: 0,
        transition: 'all 0.3s',
      }}
    >
      {isEmoji ? emoji : initials}
    </div>
  )
}
