import {
  Wrench,
  KeyRound,
  Braces,
  Code2,
  Binary,
  GitCompare,
  Search,
  FileSearch,
  FileCode,
  Shuffle,
  Shield,
} from 'lucide-react'
import type { ToolProtocol } from '../types'

export interface ToolCatalogItem {
  protocol: ToolProtocol
  Icon: typeof Wrench
  labelKey: string
  bg: string
  color: string
}

export const TOOL_CATALOG: ToolCatalogItem[] = [
  {
    protocol: 'tools.jwt',
    Icon: KeyRound,
    labelKey: 'tools.jwt.title',
    bg: '#eeecfe',
    color: '#5b52d4',
  },
  {
    protocol: 'tools.jsonFormat',
    Icon: Braces,
    labelKey: 'tools.json.title',
    bg: '#e8f4ff',
    color: '#0066cc',
  },
  {
    protocol: 'tools.xmlFormat',
    Icon: Code2,
    labelKey: 'tools.xml.title',
    bg: '#fff4e0',
    color: '#b35a00',
  },
  {
    protocol: 'tools.encode',
    Icon: Binary,
    labelKey: 'tools.encode.title',
    bg: '#e8f9f1',
    color: '#1a7a4a',
  },
  {
    protocol: 'tools.diff',
    Icon: GitCompare,
    labelKey: 'tools.diff.title',
    bg: '#fff0f0',
    color: '#cc2200',
  },
  {
    protocol: 'tools.jsonpath',
    Icon: Search,
    labelKey: 'tools.jsonpath.title',
    bg: '#e8f4ff',
    color: '#0066cc',
  },
  {
    protocol: 'tools.xpath',
    Icon: FileSearch,
    labelKey: 'tools.xpath.title',
    bg: '#fff4e0',
    color: '#b35a00',
  },
  {
    protocol: 'tools.xslt',
    Icon: FileCode,
    labelKey: 'tools.xslt.title',
    bg: '#f0faf5',
    color: '#0a7a5a',
  },
  {
    protocol: 'tools.jolt',
    Icon: Shuffle,
    labelKey: 'tools.jolt.title',
    bg: '#eeecfe',
    color: '#5b52d4',
  },
  {
    protocol: 'tools.wsSecurity',
    Icon: Shield,
    labelKey: 'tools.wsse.title',
    bg: '#e8f4ff',
    color: '#0066cc',
  },
]
