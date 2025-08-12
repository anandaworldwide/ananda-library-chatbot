import React from "react";
import { render, screen, act } from "@testing-library/react";
import { SudoProvider, useSudo } from "@/contexts/SudoContext";

// Mock fetchWithAuth from tokenManager
jest.mock("@/utils/client/tokenManager", () => ({
  fetchWithAuth: jest.fn(),
}));

const TestConsumer: React.FC = () => {
  const { isSudoUser, errorMessage, checkSudoStatus } = useSudo();
  return (
    <div>
      <div data-testid="isSudoUser">{String(isSudoUser)}</div>
      <div data-testid="errorMessage">{errorMessage ?? ""}</div>
      <button onClick={() => void checkSudoStatus()}>check</button>
    </div>
  );
};

describe("SudoContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("skips sudo checks on /login and does not call fetchWithAuth", async () => {
    const { fetchWithAuth } = jest.requireMock("@/utils/client/tokenManager") as {
      fetchWithAuth: jest.Mock;
    };

    // Simulate running on /login
    Object.defineProperty(window, "location", {
      value: { pathname: "/login" },
      writable: true,
    });

    render(
      <SudoProvider>
        <TestConsumer />
      </SudoProvider>
    );

    // Trigger explicit check
    await act(async () => {
      screen.getByText("check").click();
    });

    // State should be reset and no network call performed
    expect(screen.getByTestId("isSudoUser").textContent).toBe("false");
    expect(screen.getByTestId("errorMessage").textContent).toBe("");
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  test("sets isSudoUser from successful response and shows IP mismatch message", async () => {
    const { fetchWithAuth } = jest.requireMock("@/utils/client/tokenManager") as {
      fetchWithAuth: jest.Mock;
    };

    // Simulate normal page
    Object.defineProperty(window, "location", {
      value: { pathname: "/admin" },
      writable: true,
    });

    // Mock a successful response with sudoCookieValue and ipMismatch
    fetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sudoCookieValue: true, ipMismatch: true }),
      status: 200,
      statusText: "OK",
    } as unknown as Response);

    render(
      <SudoProvider>
        <TestConsumer />
      </SudoProvider>
    );

    // Trigger explicit check
    await act(async () => {
      screen.getByText("check").click();
    });

    expect(fetchWithAuth).toHaveBeenCalledWith("/api/sudoCookie", {
      method: "GET",
      credentials: "include",
    });
    expect(screen.getByTestId("isSudoUser").textContent).toBe("true");
    expect(screen.getByTestId("errorMessage").textContent).toBe("Your IP has changed. Please re-authenticate.");
  });
});
