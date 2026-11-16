/**
 * @jest-environment jsdom
 */

/**
 * UI status tests for the ebook catalog card.
 *
 * Managers (Admin/Pustakawan) must never see the "Terkunci" overlay, even if a
 * stale loan row exists for their account, and "Lihat Buku" must invoke the
 * reader. Borrowers keep the existing lock/borrow behaviour.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { EbookCard, EbookListItem } from "@/components/ebooks/EbookCard";

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, alt }: { src?: string; alt?: string }) => (
    <img src={src} alt={alt} />
  ),
}));

function buildEbook(overrides: Partial<EbookListItem> = {}): EbookListItem {
  return {
    id: "book-1",
    title: "Ebook Uji",
    author: "Penulis",
    coverUrl: null,
    pageCount: 10,
    accessState: "NOT_BORROWED",
    remainingMs: 0,
    canBorrow: true,
    loan: null,
    ...overrides,
  };
}

function renderCard(ebook: EbookListItem, canManage: boolean, canBorrowRole = !canManage) {
  const onOpenReader = jest.fn();
  const onBorrow = jest.fn();
  const onReturn = jest.fn();

  render(
    <EbookCard
      ebook={ebook}
      isBusy={false}
      maxActiveLoans={3}
      canBorrowRole={canBorrowRole}
      canManage={canManage}
      onBorrow={onBorrow}
      onReturn={onReturn}
      onOpenReader={onOpenReader}
    />
  );

  return { onOpenReader, onBorrow, onReturn };
}

describe("EbookCard – manager (Admin/Pustakawan)", () => {
  it.each([true, false])(
    "does not render the locked overlay for a manager (server operator flag: %s)",
    (serverOperator) => {
      const { container } = render(
        <EbookCard
          ebook={buildEbook({
            accessState: "EXPIRED",
            operator: serverOperator,
          })}
          isBusy={false}
          maxActiveLoans={3}
          canBorrowRole={false}
          canManage
          onBorrow={jest.fn()}
          onReturn={jest.fn()}
          onOpenReader={jest.fn()}
        />
      );

      expect(screen.queryByText(/terkunci/i)).toBeNull();
      expect(container.textContent).not.toContain("Terkunci");
    }
  );

  it("shows Lihat Buku and opens the reader instead of borrowing", () => {
    const { onOpenReader, onBorrow } = renderCard(
      buildEbook({ accessState: "NOT_BORROWED" }),
      true
    );

    fireEvent.click(screen.getByRole("button", { name: /lihat buku/i }));

    expect(onOpenReader).toHaveBeenCalledTimes(1);
    expect(onBorrow).not.toHaveBeenCalled();
  });

  it("opens the reader even when a stale loan is marked expired", () => {
    const { onOpenReader } = renderCard(
      buildEbook({ accessState: "EXPIRED" }),
      true
    );

    fireEvent.click(screen.getByRole("button", { name: /lihat buku/i }));

    expect(onOpenReader).toHaveBeenCalledTimes(1);
  });
});

describe("EbookCard – borrower rules preserved", () => {
  it("still shows the locked overlay to a student with an expired loan", () => {
    renderCard(buildEbook({ accessState: "EXPIRED", canBorrow: false }), false);

    expect(screen.getByText("Terkunci")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /lihat buku/i })).toBeNull();
  });

  it("still shows the borrow action to a student without a loan", () => {
    const { onBorrow } = renderCard(buildEbook(), false);

    fireEvent.click(screen.getByRole("button", { name: /^pinjam ebook/i }));

    expect(onBorrow).toHaveBeenCalledTimes(1);
  });
});
