import styles from './LetterAvatar.module.css'

export function LetterAvatar({ name, square = false }: { name: string; square?: boolean }) {
  const letter = (name || '?').trim().charAt(0).toUpperCase()
  return <span className={`${styles.avatar} ${square ? styles.square : ''}`}>{letter}</span>
}
