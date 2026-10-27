import React from 'react'

import { t } from '@/i18n'

interface Props {
  children?: React.ReactNode
}

interface State {
  hasError: boolean
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)

    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    // biome-ignore lint/suspicious/noConsole: <>
    console.log({ error, errorInfo })
  }

  render() {
    const { hasError } = this.state
    const { children } = this.props
    if (hasError) {
      return (
        <div className="w-full h-full flex justify-center items-center">
          <h2>{t('errorBoundary.title')}</h2>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
          >
            {t('errorBoundary.retry')}
          </button>
        </div>
      )
    }

    return children
  }
}

export default ErrorBoundary
