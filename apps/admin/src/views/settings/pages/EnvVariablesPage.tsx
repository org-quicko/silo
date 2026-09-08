import { useState } from 'react'
import { AlertTriangle, Plus, Variable } from 'lucide-react'
import { VariableName } from '@silo/shared/variable-name'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { DangerConfirm } from '../../../components/modal/DangerConfirm'
import { LoadingState } from '../../../components/feedback/LoadingState'
import type { ScopeRef } from '../../../api/types/scope-ref'
import { Routes } from '../../../router/routes'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import { useVariablesForm } from './use-variables-form'
import { VariableRow } from './VariableRow'
import settings from '../SettingsView.module.css'
import styles from './EnvVariablesPage.module.css'

/**
 * Variables for one environment (D57).
 *
 * The page holds two different reaches on one screen, which is deliberate and
 * is why the copy keeps saying which is which: the **name** belongs to the
 * project and reads the same in every environment, the **value** belongs to
 * this environment and nothing else sees it. Splitting them across two pages
 * would mean declaring a name and giving it a value were two errands in two
 * places, which is not how anyone adds a variable.
 */
export function EnvVariablesPage({
  server,
  scope,
  environments,
  claims,
}: {
  server: Server
  scope: ScopeRef
  /** Every environment in this project, for the "set in 2 of 3" count. */
  environments: string[]
  claims: string[]
}) {
  const form = useVariablesForm(server.id, server.url, server.apiKey, scope, claims)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [value, setValue] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)

  const nameValid = VariableName.isValid(name)
  const duplicate = form.variables.some((variable) => variable.name === name)
  const canAdd = nameValid && !duplicate && form.busy === null

  const add = async () => {
    if (!canAdd) return
    const added = await form.declare({ name, description, value })
    if (!added) return
    setName('')
    setDescription('')
    setValue('')
  }

  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb
          crumbs={[
            { label: scope.project, to: Routes.projectSettings(server.id, scope.project, 'general') },
            { label: scope.env, to: Routes.envSettings(server.id, scope.project, scope.env, 'general') },
            { label: 'Variables' },
          ]}
        />
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Variables</h2>
            <span className="page-sub">
              Write <code>{'{{NAME}}'}</code> in any entry field and the API returns this
              environment's value in its place. Names are shared across{' '}
              <b>{scope.project}</b>; values belong to <b>{scope.env}</b>.
            </span>
          </div>
        </div>

        {form.error && (
          <div className={settings.alertError}>
            <AlertTriangle size={15} />
            <span>{form.error}</span>
          </div>
        )}

        {form.writeError && (
          <div className={settings.alertError}>
            <AlertTriangle size={15} />
            <span>{form.writeError}</span>
            <Button variant="secondary" size="sm" onClick={form.clearWriteError}>
              Dismiss
            </Button>
          </div>
        )}

        <div className={settings.generalContent}>
          <section className={styles.panel}>
            <div className={styles.header}>
              <span className={styles.heading}>
                <Variable size={15} /> {scope.env}
              </span>
              <p>
                A value is substituted into every entry that references it, so it is readable by
                anyone who can read those entries. Do not put secrets here.
              </p>
            </div>

            {!form.loaded && form.loading ? (
              <LoadingState message="Loading variables" inline />
            ) : form.variables.length === 0 ? (
              <div className={styles.empty}>
                No variables in <b>{scope.project}</b> yet. Declare one below, then reference it as{' '}
                <span className={styles.emptyToken}>{'{{NAME}}'}</span> in an entry.
              </div>
            ) : (
              <div className={styles.rows}>
                {form.variables.map((variable) => (
                  <VariableRow
                    key={variable.name}
                    variable={variable}
                    env={scope.env}
                    environments={Math.max(environments.length, 1)}
                    busy={form.busy === variable.name}
                    canSetValue={form.canSetValue}
                    canUndeclare={form.canUndeclare}
                    onSave={(next) => form.setValue(variable.name, next)}
                    onClear={() => form.clearValue(variable.name)}
                    onDelete={() => setRemoving(variable.name)}
                  />
                ))}
              </div>
            )}
          </section>

          {form.canDeclare && (
            <section className={styles.panel}>
              <div className={styles.header}>
                <span className={styles.heading}>
                  <Plus size={15} /> Declare a variable
                </span>
                <p>
                  The name is added to every environment in <b>{scope.project}</b>. A value is
                  optional and applies to <b>{scope.env}</b> only.
                </p>
              </div>

              <form
                className={styles.addRow}
                onSubmit={(event) => {
                  event.preventDefault()
                  void add()
                }}
              >
                <div className="field">
                  <label className="field-label" htmlFor="variable-name">
                    Name
                  </label>
                  <input
                    id="variable-name"
                    className="input"
                    type="text"
                    value={name}
                    placeholder="API_URL"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setName(event.target.value)}
                  />
                  {name !== '' && !nameValid && (
                    <span className="field-error">
                      Letters, digits and underscores. Cannot start with a digit.
                    </span>
                  )}
                  {duplicate && <span className="field-error">Already declared.</span>}
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="variable-description">
                    Description
                  </label>
                  <input
                    id="variable-description"
                    className="input"
                    type="text"
                    value={description}
                    placeholder="Optional"
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="variable-value">
                    Value in {scope.env}
                  </label>
                  <input
                    id="variable-value"
                    className="input"
                    type="text"
                    value={value}
                    placeholder="Optional"
                    disabled={!form.canSetValue}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </div>

                <Button variant="primary" type="submit" disabled={!canAdd}>
                  {form.busy === '' ? 'Adding…' : 'Add'}
                </Button>
              </form>
            </section>
          )}
        </div>
      </div>

      {removing && (
        <DangerConfirm
          title={`Remove ${removing}?`}
          confirmWord={removing}
          confirmLabel="Remove everywhere"
          busyLabel="Removing…"
          busy={form.busy === removing}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const done = await form.undeclare(removing)
            if (done) setRemoving(null)
          }}
        >
          This removes the name from every environment in <b>{scope.project}</b> and deletes each
          one's value. Entries already written keep the text{' '}
          <code>{`{{${removing}}}`}</code> and the API will return it unchanged.
        </DangerConfirm>
      )}
    </>
  )
}
