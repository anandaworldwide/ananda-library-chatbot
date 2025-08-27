// Lists active users for the current site for admin UI
//
// SCALABILITY NOTE: For large user bases (1000+ users), consider these optimizations:
// 1. Add computed 'displayName' field to user documents during creation/update
// 2. Create Firestore composite index on ['inviteStatus', 'displayName']
// 3. Use native Firestore orderBy('displayName') instead of in-memory sorting
// 4. Implement full-text search using Algolia or similar for advanced search features
// 5. Add database indexes for firstName, lastName, email for efficient search filtering
// 6. Consider cursor-based pagination for better performance with large datasets
//
// Current implementation fetches all users for name sorting (acceptable for <500 users)
// but will need optimization as user base grows beyond typical small-to-medium organizations.

import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!db) return res.status(503).json({ error: "Database not available" });

  const usersCol = getUsersCollectionName();

  // Parse pagination parameters
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = (page - 1) * limit;
  const sortBy = (req.query.sortBy as string) || "login-desc";
  const searchQuery = (req.query.search as string) || "";

  try {
    // Helper function to get display name
    const getDisplayName = (user: any) => {
      const firstName = user.firstName?.trim() || "";
      const lastName = user.lastName?.trim() || "";
      if (firstName && lastName) return `${firstName} ${lastName}`;
      if (firstName) return firstName;
      if (lastName) return lastName;
      return user.email;
    };

    // Helper function to check if user matches search query
    const matchesSearch = (user: any, query: string) => {
      if (!query) return true;
      const searchLower = query.toLowerCase();
      const displayName = getDisplayName(user).toLowerCase();
      const email = (user.email || "").toLowerCase();
      return displayName.includes(searchLower) || email.includes(searchLower);
    };

    let allUsers: any[] = [];
    let filteredUsers: any[] = [];
    let items: any[] = [];

    // Always fetch all users when we have search or name sorting
    if (searchQuery || sortBy === "name-asc") {
      const allSnapshot = await db.collection(usersCol).where("inviteStatus", "==", "accepted").get();

      allUsers = allSnapshot.docs.map((d: any) => {
        const data = d.data() || {};
        return {
          email: data.email,
          firstName: data.firstName || null,
          lastName: data.lastName || null,
          uuid: data.uuid || null,
          role: data.role || undefined,
          verifiedAt: data.verifiedAt?.toDate?.() ?? null,
          lastLoginAt: data.lastLoginAt?.toDate?.() ?? null,
          entitlements: data.entitlements || {},
        };
      });

      // Apply search filter
      filteredUsers = searchQuery ? allUsers.filter((user) => matchesSearch(user, searchQuery)) : allUsers;

      // Apply sorting
      if (sortBy === "name-asc") {
        filteredUsers.sort((a, b) => {
          const nameA = getDisplayName(a).toLowerCase();
          const nameB = getDisplayName(b).toLowerCase();
          return nameA.localeCompare(nameB);
        });
      } else {
        // Sort by login desc
        filteredUsers.sort((a, b) => {
          if (!a.lastLoginAt && !b.lastLoginAt) return 0;
          if (!a.lastLoginAt) return 1;
          if (!b.lastLoginAt) return -1;
          return new Date(b.lastLoginAt).getTime() - new Date(a.lastLoginAt).getTime();
        });
      }
    } else {
      // For login-desc sorting without search, use efficient Firestore query
      const snapshot = await db
        .collection(usersCol)
        .where("inviteStatus", "==", "accepted")
        .orderBy("lastLoginAt", "desc")
        .get();

      filteredUsers = snapshot.docs.map((d: any) => {
        const data = d.data() || {};
        return {
          email: data.email,
          firstName: data.firstName || null,
          lastName: data.lastName || null,
          uuid: data.uuid || null,
          role: data.role || undefined,
          verifiedAt: data.verifiedAt?.toDate?.() ?? null,
          lastLoginAt: data.lastLoginAt?.toDate?.() ?? null,
          entitlements: data.entitlements || {},
        };
      });
    }

    // Calculate pagination based on filtered results
    const totalCount = filteredUsers.length;
    items = filteredUsers.slice(offset, offset + limit);

    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json({
      items,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to list active users" });
  }
}

export default withApiMiddleware(withJwtAuth(handler));
