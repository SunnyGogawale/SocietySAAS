import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';

describe('application shell', () => {
  it('renders the workspace overview without business data', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Business workflows are not enabled')).toBeInTheDocument();
  });
});
