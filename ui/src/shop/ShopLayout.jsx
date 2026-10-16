import { Link, Outlet } from 'react-router'
import SiteHeader from './SiteHeader.jsx'
import { ImageSearchProvider } from './ImageSearchContext.jsx'
import { ChatProvider } from '../chat/ChatProvider.jsx'
import ChatWidget from '../chat/ChatWidget.jsx'
import './shop.css'

export default function ShopLayout() {
  return (
    <ImageSearchProvider>
      <ChatProvider>
        <div className="shop">
          <SiteHeader />
          <main>
            <Outlet />
          </main>
          <footer className="site-footer">
            <Link to="/lab">Retrieval Lab</Link>
          </footer>
          <ChatWidget />
        </div>
      </ChatProvider>
    </ImageSearchProvider>
  )
}

