/**
 * Issue #113 — which right-click gets a native menu, and what it may do.
 *
 * Main cannot make this call on its own: its `context-menu` event reports
 * `isEditable: false` for a click on a Monaco `.view-line` div even though the
 * caret sits in the editor's hidden textarea. That is precisely why Monaco's
 * broken built-in menu was the only one users ever saw there.
 */
import { describe, it, expect } from 'vitest'
import { describeContextTarget } from '../../src/renderer/lib/native-context-menu'

function el(html: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host.firstElementChild!
}

describe('form fields', () => {
  it('treats a text input as editable', () => {
    expect(describeContextTarget(el('<input type="text" />'), '')).toEqual({
      editable: true,
      hasSelection: false,
    })
  })

  it('treats a textarea as editable', () => {
    expect(describeContextTarget(el('<textarea></textarea>'), '').editable).toBe(true)
  })

  it('reads the selection from the control, not from the document', () => {
    // A selection inside an input is not a DOM selection — getSelection()
    // reports nothing, so asking the document would grey out Copy on text the
    // user can plainly see highlighted.
    const input = el('<input type="text" value="hello" />') as HTMLInputElement
    input.setSelectionRange(0, 3)
    expect(describeContextTarget(input, '').hasSelection).toBe(true)
  })

  it('does not treat a checkbox as a text field', () => {
    expect(describeContextTarget(el('<input type="checkbox" />'), '').editable).toBe(false)
  })

  it('treats a contenteditable region as editable', () => {
    expect(describeContextTarget(el('<div contenteditable="true">x</div>'), '').editable).toBe(true)
  })

  it('finds the field when the click lands on something inside it', () => {
    const wrapper = el('<div class="monaco-editor"><span class="view-line">code</span></div>')
    const line = wrapper.querySelector('.view-line')!
    expect(describeContextTarget(line, '').editable).toBe(true)
  })
})

describe('the code editor', () => {
  it('keeps Cut and Copy available', () => {
    // Monaco draws its selection rather than making a DOM one, so there is
    // nothing to inspect; with no selection those commands act on the current
    // line, which is what every code editor does.
    expect(
      describeContextTarget(
        el('<div data-monaco-readonly="false"><div class="monaco-editor"></div></div>')
          .firstElementChild!,
        '',
      ),
    ).toEqual({ editable: true, hasSelection: true })
  })

  it('does not call a read-only editor editable', () => {
    // The response body is a read-only Monaco. Calling it editable would offer
    // an enabled Paste that silently does nothing — the exact defect this
    // change removes — on the most right-clicked surface in the app.
    const readOnly = el(
      '<div data-monaco-readonly="true"><div class="monaco-editor"></div></div>',
    ).firstElementChild!
    expect(describeContextTarget(readOnly, '')).toEqual({ editable: false, hasSelection: true })
  })

  it('still offers Copy on a read-only editor', () => {
    // Reporting "no selection" instead would leave the response pane with no
    // menu at all, which is worse than the bug being fixed.
    const readOnly = el(
      '<div data-monaco-readonly="true"><div class="monaco-editor"></div></div>',
    ).firstElementChild!
    expect(describeContextTarget(readOnly, '').hasSelection).toBe(true)
  })
})

describe('ordinary page chrome', () => {
  it('is not editable', () => {
    expect(describeContextTarget(el('<div>label</div>'), '').editable).toBe(false)
  })

  it('still reports a document selection so Copy can be offered', () => {
    expect(describeContextTarget(el('<div>label</div>'), 'some text').hasSelection).toBe(true)
  })

  it('ignores a whitespace-only selection', () => {
    expect(describeContextTarget(el('<div>label</div>'), '   \n ').hasSelection).toBe(false)
  })

  it('handles a click with no element at all', () => {
    expect(describeContextTarget(null, '')).toEqual({ editable: false, hasSelection: false })
  })
})
