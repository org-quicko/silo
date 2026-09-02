import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { PlatformKeys } from '../../utils/platform-keys'
import styles from './ShortcutsDialog.module.css'

interface Group {
  label: string
  rows: Array<[keys: string[], meaning: string]>
}

/** Grouped by where they work, because half of them only work on one page. */
function groups(): Group[] {
  return [
    {
      label: 'Anywhere',
      rows: [
        [[`${PlatformKeys.command()}K`, '/'], 'Search'],
        [[`${PlatformKeys.alt()}F`], 'Filter the collection list'],
        [['?'], 'This list'],
      ],
    },
    {
      label: 'Entries list',
      rows: [
        [['↓', 'j'], 'Next row'],
        [['↑', 'k'], 'Previous row'],
        [['Home', 'End'], 'First row, last row'],
        [['Enter', 'e'], 'Open the row'],
        [['⌫'], 'Delete the row'],
        [['←', 'h'], 'Previous page'],
        [['→', 'l'], 'Next page'],
        [['n'], 'New entry'],
        [['f'], 'Filters'],
        [['c'], 'Columns'],
        [['Esc'], 'Close, or drop the cursor'],
      ],
    },
    {
      label: 'Editors',
      rows: [[['Esc'], 'Discard and go back']],
    },
  ]
}

/** What the admin answers to, for a reader with no other way to find out. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalCopy>
          <h3>Keyboard shortcuts</h3>
        </ModalCopy>
      </ModalHeader>

      <div className={styles.groups}>
        {groups().map((group) => (
          <dl className={styles.group} key={group.label}>
            <span className={styles.groupLabel}>{group.label}</span>
            {group.rows.map(([keys, meaning]) => (
              <div className={styles.row} key={`${group.label}-${meaning}`}>
                <dt className={styles.keys}>
                  {keys.map((key) => (
                    <kbd className={styles.keycap} key={key}>
                      {key}
                    </kbd>
                  ))}
                </dt>
                <dd className={styles.meaning}>{meaning}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>

      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </ModalActions>
    </Modal>
  )
}
