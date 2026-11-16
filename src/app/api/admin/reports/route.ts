import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const startDateStr = searchParams.get("startDate");
    const endDateStr = searchParams.get("endDate");

    let dateFilter: any = {};
    if (startDateStr && endDateStr) {
      dateFilter = {
        gte: new Date(startDateStr),
        lte: new Date(endDateStr),
      };
    }

    // 1. STATS OVERVIEW
    const totalBooksAgg = await prisma.book.aggregate({
      where: { archivedAt: null },
      _sum: { stock: true },
    });
    const totalBooks = totalBooksAgg._sum.stock || 0;
    const totalUsers = await prisma.user.count({ where: { isActive: true } });
    
    const totalBorrows = await prisma.borrowRecord.count({
      where: Object.keys(dateFilter).length > 0 ? { borrowDate: dateFilter } : {},
    });

    const activeBorrows = await prisma.borrowRecord.count({
      where: { status: { in: ["BORROWED", "OVERDUE"] } },
    });

    const pendingRequests = await prisma.borrowRecord.count({
      where: { status: "REQUESTED" },
    });

    const now = new Date();
    const overdueBooks = await prisma.borrowRecord.count({
      where: {
        OR: [
          { status: "OVERDUE" },
          { status: "BORROWED", dueDate: { lt: now } }
        ]
      }
    });

    const returns = await prisma.borrowRecord.count({
      where: {
        status: "RETURNED",
        ...(Object.keys(dateFilter).length > 0 ? { returnDate: dateFilter } : {})
      }
    });

    // Fines: total assessed (snapshotted at return) vs. total actually collected.
    const fineAssessedAgg = await prisma.borrowRecord.aggregate({
      _sum: { fineAmount: true },
      where: {
        status: "RETURNED",
        ...(Object.keys(dateFilter).length > 0 ? { returnDate: dateFilter } : {}),
      },
    });
    const fineAssessed = fineAssessedAgg._sum.fineAmount || 0;

    const fineCollectedAgg = await prisma.finePayment.aggregate({
      _sum: { amount: true },
      where: Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {},
    });
    const fineCollected = fineCollectedAgg._sum.amount || 0;

    // 2. CHART DATA (Time-series)
    // Fetch only dates for lightweight processing
    const borrowsForChart = await prisma.borrowRecord.findMany({
      where: Object.keys(dateFilter).length > 0 ? { borrowDate: dateFilter } : {},
      select: { borrowDate: true, returnDate: true, status: true },
    });

    const chartMap = new Map<string, { date: string; borrows: number; returns: number }>();
    
    borrowsForChart.forEach(b => {
      // Group by YYYY-MM-DD
      const dateKey = b.borrowDate.toISOString().split("T")[0];
      if (!chartMap.has(dateKey)) chartMap.set(dateKey, { date: dateKey, borrows: 0, returns: 0 });
      chartMap.get(dateKey)!.borrows += 1;

      if (b.status === "RETURNED" && b.returnDate) {
        const retKey = b.returnDate.toISOString().split("T")[0];
        // Only count returns in chart if it's within the requested period? We'll just count all returns that fall on dates where borrows happened or we create a new entry.
        if (!chartMap.has(retKey)) chartMap.set(retKey, { date: retKey, borrows: 0, returns: 0 });
        chartMap.get(retKey)!.returns += 1;
      }
    });

    const chartData = Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // 3. TOP BOOKS & CATEGORIES
    // To do this efficiently, we fetch the top 5 book IDs from BorrowRecords
    const topBookGroups = await prisma.borrowRecord.groupBy({
      by: ["bookId"],
      _count: { bookId: true },
      where: Object.keys(dateFilter).length > 0 ? { borrowDate: dateFilter } : {},
      orderBy: { _count: { bookId: "desc" } },
      take: 5,
    });

    const topBookIds = topBookGroups.map((g) => g.bookId);
    const topBookDetails = await prisma.book.findMany({
      where: { id: { in: topBookIds } },
      select: { id: true, title: true, categoryId: true },
    });
    const topBookMap = new Map(topBookDetails.map((b) => [b.id, b]));

    const topBooks = topBookGroups.map((g) => {
      const book = topBookMap.get(g.bookId);
      return { title: book?.title || "Unknown", count: g._count.bookId, categoryId: book?.categoryId };
    });

    // Calculate top categories from the borrows (we can do a simple frequency map from a wider query or just use the top books' categories as a proxy, but better to query real categories)
    // Since SQLite doesn't support nested relation grouping easily, we fetch category info for the borrowed books
    const allBorrowsWithCategories = await prisma.borrowRecord.findMany({
      where: Object.keys(dateFilter).length > 0 ? { borrowDate: dateFilter } : {},
      select: { book: { select: { category: { select: { name: true } } } } }
    });

    const catMap = new Map<string, number>();
    allBorrowsWithCategories.forEach(b => {
      const catName = b.book?.category?.name || "Uncategorized";
      catMap.set(catName, (catMap.get(catName) || 0) + 1);
    });

    const topCategories = Array.from(catMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 4. RAW LIST FOR EXPORT
    // Fetch limited raw data for the table/CSV export (up to 500 rows to prevent overwhelming the browser)
    const exportList = await prisma.borrowRecord.findMany({
      where: Object.keys(dateFilter).length > 0 ? { borrowDate: dateFilter } : {},
      orderBy: { borrowDate: "desc" },
      take: 500,
      select: {
        id: true,
        borrowDate: true,
        dueDate: true,
        returnDate: true,
        status: true,
        fineAmount: true,
        finePaid: true,
        user: { select: { name: true, role: true } },
        book: { select: { title: true } },
      }
    });

    return NextResponse.json({
      stats: {
        totalBooks,
        totalUsers,
        totalBorrows,
        activeBorrows,
        pendingRequests,
        overdueBooks,
        returns,
        fineAssessed,
        fineCollected,
        fineOutstanding: Math.max(0, fineAssessed - fineCollected),
      },
      chartData,
      topBooks,
      topCategories,
      exportList,
    });

  } catch (error) {
    console.error("Reports API Error:", error);
    return NextResponse.json({ error: "Failed to fetch report data" }, { status: 500 });
  }
}
