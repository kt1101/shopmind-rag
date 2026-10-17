import { Link } from 'react-router'
import { useI18n } from '../shared/ui/I18nProvider.jsx'

export default function NotFoundPage() {
  const { t } = useI18n()
  return (
    <div className="not-found-page">
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.text')}</p>
      <Link to="/">{t('notFound.back')}</Link>
    </div>
  )
}
