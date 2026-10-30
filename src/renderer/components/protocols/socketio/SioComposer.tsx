import { Plus, Save, Send } from 'lucide-react'
import { useSocketIOStore } from '../../../stores/socketio.store'
import { useTranslation } from '../../../lib/i18n'
import VariableAutocompleteInput from '../../shared/VariableAutocompleteInput'
import { Checkbox, GhostButton, PrimaryButton } from '../../mock-mcp/ui'
import SavedMessagesPane from '../realtime/SavedMessagesPane'
import SioArgRow from './SioArgRow'
import CredentialRestartHint from '../../shared/CredentialRestartHint'
import { scrubMessageCredentials } from '../../../lib/credential-text'

/**
 * Socket.IO Message tab (issue #283), Postman's composer: event name (empty =
 * `message`), Ack, any number of arguments each with its own format, Emit,
 * and Save into the "Saved messages" pane on the right (updates the loaded
 * message, else adds one).
 */
export default function SioComposer() {
  const { t } = useTranslation()
  const emitEvent = useSocketIOStore((s) => s.emitEvent)
  const emitArgs = useSocketIOStore((s) => s.emitArgs)
  const emitAck = useSocketIOStore((s) => s.emitAck)
  const connected = useSocketIOStore((s) => s.connectionState === 'connected')
  const saved = useSocketIOStore((s) => s.savedMessages)
  const activeSavedId = useSocketIOStore((s) => s.activeSavedMessageId)
  const setEmitEvent = useSocketIOStore((s) => s.setEmitEvent)
  const setEmitAck = useSocketIOStore((s) => s.setEmitAck)
  const addArg = useSocketIOStore((s) => s.addArg)
  const emit = useSocketIOStore((s) => s.emit)
  const saveCurrent = useSocketIOStore((s) => s.saveCurrentMessage)
  const addSaved = useSocketIOStore((s) => s.addSavedMessage)
  const loadSaved = useSocketIOStore((s) => s.loadSavedMessage)
  const renameSaved = useSocketIOStore((s) => s.renameSavedMessage)
  const deleteSaved = useSocketIOStore((s) => s.deleteSavedMessage)

  return (
    <div className="flex min-h-0 gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <VariableAutocompleteInput
            value={emitEvent}
            onChange={setEmitEvent}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && connected) void emit()
            }}
            placeholder={t('socketio.eventNamePlaceholder')}
            data-testid="socketio-event-name"
            className="h-8 min-w-[10rem] flex-1 rounded-md border border-[var(--border)] bg-[var(--white)] px-2 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <Checkbox
            checked={emitAck}
            onChange={setEmitAck}
            label={t('socketio.ack')}
            testId="socketio-ack"
          />
          <PrimaryButton
            onClick={() => void emit()}
            disabled={!connected}
            data-testid="socketio-emit"
            className="h-8"
          >
            <Send size={13} aria-hidden />
            {t('socketio.emit')}
          </PrimaryButton>
          <GhostButton
            onClick={saveCurrent}
            data-testid="socketio-save-message"
            title={t('rt.saved.saveHint')}
            className="h-8"
          >
            <Save size={13} aria-hidden />
            {t('common.save')}
          </GhostButton>
        </div>
        <p className="m-0 text-[11px] text-[var(--muted)]">{t('socketio.ackHint')}</p>
        <div className="flex flex-col gap-2">
          {emitArgs.map((arg, i) => (
            <SioArgRow key={arg.id} arg={arg} index={i} removable={emitArgs.length > 1} />
          ))}
        </div>
        {emitArgs.some((a) => scrubMessageCredentials(a.content) !== a.content) && (
          <CredentialRestartHint
            id="socketio-args-restart-hint-text"
            testId="socketio-args-restart-hint"
          />
        )}
        <button
          type="button"
          onClick={addArg}
          data-testid="socketio-add-arg"
          className="flex w-fit cursor-pointer items-center gap-1 rounded border-none bg-transparent px-0 text-[12px] text-[var(--accent-text)] hover:underline"
        >
          <Plus size={12} aria-hidden />
          {t('socketio.addArg')}
        </button>
      </div>
      <div className="w-56 shrink-0 border-l border-[var(--border)] pl-3">
        <SavedMessagesPane
          items={saved.map((m) => ({
            id: m.id,
            name: m.name,
            subtitle: `${m.eventName}${m.acknowledgement ? ` · ${t('socketio.ackShort')}` : ''} · ${t(
              m.args.length === 1 ? 'socketio.argsOne' : 'socketio.argsOther',
            ).replace('{n}', String(m.args.length))}`,
          }))}
          activeId={activeSavedId}
          onLoad={loadSaved}
          onRename={renameSaved}
          onDelete={deleteSaved}
          onAdd={() => addSaved(t('rt.saved.defaultName').replace('{n}', String(saved.length + 1)))}
          testIdPrefix="socketio"
        />
      </div>
    </div>
  )
}
