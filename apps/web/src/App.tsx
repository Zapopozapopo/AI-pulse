import { Route, Routes } from 'react-router-dom';
import { CompetitorListPage } from './pages/CompetitorListPage';
import { CompetitorTimelinePage } from './pages/CompetitorTimelinePage';

export function App() {
  return (
    <main className="container">
      <h1>CompetitorPulse</h1>
      <Routes>
        <Route path="/" element={<CompetitorListPage />} />
        <Route path="/competitors/:id" element={<CompetitorTimelinePage />} />
      </Routes>
    </main>
  );
}
