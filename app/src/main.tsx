import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './launch.css'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

// 설정 검증(config.ts)은 App import 시점에 실행된다.
// 흰 화면 대신 "무엇이 잘못됐는지"를 보여주기 위해 ErrorBoundary 로 감싼다.
const container = document.getElementById('root')
if (!container) throw new Error('#root element is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
