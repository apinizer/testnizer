import { useState } from 'react'
import { Plus, Settings2, Trash2 } from 'lucide-react'
import { useMqttStore } from '../../../stores/mqtt.store'
import { useTranslation } from '../../../lib/i18n'
import type { MqttRetainHandling, MqttTopic } from '../../../../shared/mqtt'
import VariableAutocompleteInput from '../../shared/VariableAutocompleteInput'
import { Checkbox, INPUT_CLS, SELECT_CLS } from '../../mock-mcp/ui'
import { QosSelect } from './mqtt-ui'

const ICON_BTN =
  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50'

/**
 * MQTT Topics tab (issue #284), Postman's list: one row per topic filter
 * (wildcards allowed) with its QoS, a description and the Subscribe toggle —
 * subscribed on Connect, and subscribed / unsubscribed at once while
 * connected. A subscribed row of a live connection is locked: turn it off to
 * change it. MQTT 5 subscription options (No Local, Retain As Published,
 * Retain Handling) sit behind the row's options button.
 */
export default function MqttTopicsTab() {
  const { t } = useTranslation()
  const topics = useMqttStore((s) => s.topics)
  const v5 = useMqttStore((s) => s.version === 5)
  const connected = useMqttStore((s) => s.connectionState === 'connected')
  const addTopic = useMqttStore((s) => s.addTopic)
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div data-testid="mqtt-topics" className="flex flex-col gap-1.5">
      {topics.length === 0 && (
        <p data-testid="mqtt-topics-empty" className="m-0 text-[11px] text-[var(--hint)]">
          {t('mqtt.topics.empty')}
        </p>
      )}
      {topics.map((topic) => (
        <TopicRow
          key={topic.id}
          topic={topic}
          locked={connected && topic.subscribe}
          v5={v5}
          optionsOpen={open === topic.id}
          onToggleOptions={() => setOpen(open === topic.id ? null : topic.id)}
        />
      ))}
      <button
        type="button"
        onClick={addTopic}
        data-testid="mqtt-topic-add"
        className="flex w-fit cursor-pointer items-center gap-1 rounded border-none bg-transparent px-1 text-[12px] text-[var(--accent-text)] hover:underline"
      >
        <Plus size={12} aria-hidden />
        {t('mqtt.topics.add')}
      </button>
    </div>
  )
}

function TopicRow({
  topic,
  locked,
  v5,
  optionsOpen,
  onToggleOptions,
}: {
  topic: MqttTopic
  locked: boolean
  v5: boolean
  optionsOpen: boolean
  onToggleOptions: () => void
}) {
  const { t } = useTranslation()
  const update = useMqttStore((s) => s.updateTopic)
  const toggle = useMqttStore((s) => s.toggleTopic)
  const remove = useMqttStore((s) => s.removeTopic)
  const patch = (p: Partial<Omit<MqttTopic, 'id'>>): void => update(topic.id, p)
  return (
    <div data-testid="mqtt-topic-row" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--text)]"
          title={t('mqtt.topics.subscribeHint')}
        >
          <input
            type="checkbox"
            role="switch"
            checked={topic.subscribe}
            onChange={() => void toggle(topic.id)}
            data-testid="mqtt-topic-subscribe"
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          {t('mqtt.topics.subscribe')}
        </label>
        <fieldset
          disabled={locked}
          className="m-0 flex min-w-0 flex-[1_1_18rem] items-center gap-2 border-none p-0"
        >
          <div className="min-w-[10rem] flex-1">
            <VariableAutocompleteInput
              value={topic.name}
              onChange={(name) => patch({ name })}
              placeholder={t('mqtt.topics.namePlaceholder')}
              data-testid="mqtt-topic-name"
              className={`${INPUT_CLS} font-mono`}
              spellCheck={false}
            />
          </div>
          <QosSelect
            value={topic.qos}
            onChange={(qos) => patch({ qos })}
            testId="mqtt-topic-qos"
            className="w-auto"
          />
        </fieldset>
        <input
          type="text"
          value={topic.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder={t('mqtt.topics.descriptionPlaceholder')}
          aria-label={t('mqtt.topics.description')}
          data-testid="mqtt-topic-description"
          className={`${INPUT_CLS} w-auto min-w-[8rem] flex-[1_1_10rem]`}
        />
        {v5 && (
          <button
            type="button"
            onClick={onToggleOptions}
            aria-expanded={optionsOpen}
            aria-label={t('mqtt.topics.options')}
            title={t('mqtt.topics.options')}
            data-testid="mqtt-topic-options"
            className={ICON_BTN}
          >
            <Settings2 size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={() => remove(topic.id)}
          aria-label={t('mqtt.topics.remove')}
          title={t('common.delete')}
          data-testid="mqtt-topic-remove"
          className={ICON_BTN}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {v5 && optionsOpen && (
        <fieldset
          disabled={locked}
          data-testid="mqtt-topic-options-panel"
          className="m-0 ml-6 flex flex-wrap items-center gap-3 border-none p-0"
        >
          <Checkbox
            checked={topic.noLocal}
            onChange={(noLocal) => patch({ noLocal })}
            label={t('mqtt.topics.noLocal')}
            testId="mqtt-topic-no-local"
          />
          <Checkbox
            checked={topic.retainAsPublished}
            onChange={(retainAsPublished) => patch({ retainAsPublished })}
            label={t('mqtt.topics.retainAsPublished')}
            testId="mqtt-topic-rap"
          />
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--text)]">
            {t('mqtt.topics.retainHandling')}
            <select
              value={topic.retainHandling}
              onChange={(e) =>
                patch({ retainHandling: Number(e.target.value) as MqttRetainHandling })
              }
              data-testid="mqtt-topic-rh"
              className={`${SELECT_CLS} w-auto`}
            >
              {[0, 1, 2].map((rh) => (
                <option key={rh} value={rh}>
                  {t(`mqtt.topics.retainHandling${rh}`)}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      )}
    </div>
  )
}
