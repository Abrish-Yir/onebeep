import { useMemo } from 'react'
import Reader from './pages/Reader'
import UnsupportedBrowser from './components/UnsupportedBrowser'
import { checkBrowserSupport } from './lib/browserSupport'

export default function App() {
  // Probe once on mount — no point re-checking per render.
  const support = useMemo(() => checkBrowserSupport(), [])
  if (!support.ok) {
    return <UnsupportedBrowser missing={support.missing} />
  }
  return <Reader />
}
