import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";

import addUserHandler from "@/pages/api/admin/addUser";
import resendActivationHandler from "@/pages/api/admin/resendActivation";
import listPendingUsersHandler from "@/pages/api/admin/listPendingUsers";

describe("Admin endpoints - unauthenticated access", () => {
  it("/api/admin/addUser returns 401 when missing Authorization header", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { email: "test@example.com" },
    });

    await addUserHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res._getJSONData()).toEqual({ error: "No token provided" });
  });

  it("/api/admin/resendActivation returns 401 when missing Authorization header", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { email: "pending@example.com" },
    });

    await resendActivationHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res._getJSONData()).toEqual({ error: "No token provided" });
  });

  it("/api/admin/listPendingUsers returns 401 when missing Authorization header", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await listPendingUsersHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res._getJSONData()).toEqual({ error: "No token provided" });
  });
});
