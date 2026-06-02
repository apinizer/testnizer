import { create } from 'zustand'
import {
  defaultUsernameToken,
  defaultTimestamp,
  defaultSignConfig,
  defaultEncryptConfig,
} from '../lib/tools/wsse'
import type {
  WsUsernameTokenConfig,
  WsTimestampConfig,
  WsSignConfig,
  WsEncryptConfig,
} from '../types'

/**
 * State for the standalone WS-Security tool. It previously lived in component
 * `useState`, so switching tabs unmounted the editor and reset every field
 * (issue #19). Lifting it to a store keeps it across tab switches.
 *
 * This is an in-memory store on purpose — it is NOT persisted to disk. The tool
 * holds private keys, passphrases, and UsernameToken passwords; writing those
 * to localStorage would leak credentials. The WSSE tool is a singleton tab, so
 * a single flat store instance is sufficient (no per-tab keying needed).
 */
export type WsseMode = 'sign' | 'verify' | 'encrypt' | 'decrypt' | 'timestamp' | 'username-token'

export const WSSE_SAMPLE_ENVELOPE = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header/>
  <soap:Body>
    <tns:Echo xmlns:tns="http://testnizer.com/echo">
      <tns:Message>Hello, WSSE</tns:Message>
    </tns:Echo>
  </soap:Body>
</soap:Envelope>`

interface WsseToolStore {
  mode: WsseMode
  input: string
  output: string
  error: string | null
  statusLine: string | null
  usernameToken: WsUsernameTokenConfig
  timestamp: WsTimestampConfig
  sign: WsSignConfig
  encrypt: WsEncryptConfig
  verifyCert: string
  decryptKey: string
  decryptPass: string

  setMode: (mode: WsseMode) => void
  setInput: (input: string) => void
  setOutput: (output: string) => void
  setError: (error: string | null) => void
  setStatusLine: (statusLine: string | null) => void
  setUsernameToken: (v: WsUsernameTokenConfig) => void
  setTimestamp: (v: WsTimestampConfig) => void
  setSign: (v: WsSignConfig) => void
  setEncrypt: (v: WsEncryptConfig) => void
  setVerifyCert: (v: string) => void
  setDecryptKey: (v: string) => void
  setDecryptPass: (v: string) => void
}

export const useWsseToolStore = create<WsseToolStore>((set) => ({
  mode: 'sign',
  input: WSSE_SAMPLE_ENVELOPE,
  output: '',
  error: null,
  statusLine: null,
  usernameToken: defaultUsernameToken(),
  timestamp: defaultTimestamp(),
  sign: defaultSignConfig(),
  encrypt: defaultEncryptConfig(),
  verifyCert: '',
  decryptKey: '',
  decryptPass: '',

  setMode: (mode) => set({ mode }),
  setInput: (input) => set({ input }),
  setOutput: (output) => set({ output }),
  setError: (error) => set({ error }),
  setStatusLine: (statusLine) => set({ statusLine }),
  setUsernameToken: (usernameToken) => set({ usernameToken }),
  setTimestamp: (timestamp) => set({ timestamp }),
  setSign: (sign) => set({ sign }),
  setEncrypt: (encrypt) => set({ encrypt }),
  setVerifyCert: (verifyCert) => set({ verifyCert }),
  setDecryptKey: (decryptKey) => set({ decryptKey }),
  setDecryptPass: (decryptPass) => set({ decryptPass }),
}))
