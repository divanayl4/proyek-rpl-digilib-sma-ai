import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
      <p className="text-sm text-muted text-center sm:text-left">
        Halaman <span className="font-medium text-main">{currentPage}</span> dari <span className="font-medium text-main">{totalPages}</span>
      </p>
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <Button 
          variant="secondary" 
          size="sm" 
          className="min-h-11"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Halaman sebelumnya"
        >
          <ChevronLeft size={16} /> Sebelumnya
        </Button>
        <Button 
          variant="secondary" 
          size="sm" 
          className="min-h-11"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Halaman selanjutnya"
        >
          Selanjutnya <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}
