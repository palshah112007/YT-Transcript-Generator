import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { ToastContainer } from '../src/components/Toast.jsx';
import { ShortcutsModal } from '../src/components/ShortcutsModal.jsx';
import { ErrorBoundary } from '../src/components/ErrorBoundary.jsx';

describe('Phase 2 Product Features & Components', () => {
  describe('ToastContainer', () => {
    it('renders empty when no toasts are provided', () => {
      const { container } = render(<ToastContainer toasts={[]} onDismiss={() => {}} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders toasts with correct message and type icon', () => {
      const toasts = [
        { id: '1', message: 'Transcript copied successfully', type: 'success' },
        { id: '2', message: 'Failed to connect', type: 'error' },
      ];
      render(<ToastContainer toasts={toasts} onDismiss={() => {}} />);

      expect(screen.getByText('Transcript copied successfully')).toBeInTheDocument();
      expect(screen.getByText('Failed to connect')).toBeInTheDocument();
    });

    it('triggers onDismiss when close button is clicked', () => {
      const handleDismiss = vi.fn();
      const toasts = [{ id: 'test-1', message: 'Action completed', type: 'info' }];
      render(<ToastContainer toasts={toasts} onDismiss={handleDismiss} />);

      const closeBtn = screen.getByRole('button', { name: /dismiss notification/i });
      fireEvent.click(closeBtn);
      expect(handleDismiss).toHaveBeenCalledWith('test-1');
    });
  });

  describe('ShortcutsModal', () => {
    it('does not render when isOpen is false', () => {
      const { container } = render(<ShortcutsModal isOpen={false} onClose={() => {}} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders shortcuts list when isOpen is true', () => {
      render(<ShortcutsModal isOpen={true} onClose={() => {}} />);
      expect(screen.getByRole('heading', { name: /keyboard shortcuts/i })).toBeInTheDocument();
      expect(screen.getByText(/quick copy transcript to clipboard/i)).toBeInTheDocument();
      expect(screen.getByText(/focus youtube url/i)).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
      const handleClose = vi.fn();
      render(<ShortcutsModal isOpen={true} onClose={handleClose} />);

      const closeBtn = screen.getByRole('button', { name: /close shortcuts dialog/i });
      fireEvent.click(closeBtn);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('ErrorBoundary', () => {
    function BrokenComponent() {
      throw new Error('Test boundary crash');
    }

    it('renders fallback screen when child component crashes', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(
        <ErrorBoundary>
          <BrokenComponent />
        </ErrorBoundary>
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      expect(screen.getByText(/test boundary crash/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reload application/i })).toBeInTheDocument();
      spy.mockRestore();
    });

    it('renders normal children when no error occurs', () => {
      render(
        <ErrorBoundary>
          <div>Everything is fine</div>
        </ErrorBoundary>
      );
      expect(screen.getByText('Everything is fine')).toBeInTheDocument();
    });
  });
});
