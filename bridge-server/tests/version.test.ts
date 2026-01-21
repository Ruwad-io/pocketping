import { describe, it, expect } from "bun:test";
import { checkWidgetVersion, getVersionHeaders } from "../src/api/routes";
import type { BridgeServerConfig, VersionCheckResult } from "../src/types";

describe("Version Management", () => {
  describe("checkWidgetVersion", () => {
    describe("without version constraints", () => {
      const config: BridgeServerConfig = {
        port: 3001,
      };

      it("should return ok when no version provided", () => {
        const result = checkWidgetVersion(undefined, config);

        expect(result.status).toBe("ok");
        expect(result.canContinue).toBe(true);
      });

      it("should return ok when version provided but no constraints", () => {
        const result = checkWidgetVersion("1.0.0", config);

        expect(result.status).toBe("ok");
        expect(result.canContinue).toBe(true);
      });
    });

    describe("with minWidgetVersion", () => {
      const config: BridgeServerConfig = {
        port: 3001,
        minWidgetVersion: "0.2.0",
      };

      it("should return ok for version equal to min", () => {
        const result = checkWidgetVersion("0.2.0", config);

        expect(result.status).toBe("ok");
        expect(result.canContinue).toBe(true);
      });

      it("should return ok for version above min", () => {
        const result = checkWidgetVersion("0.3.0", config);

        expect(result.status).toBe("ok");
        expect(result.canContinue).toBe(true);
      });

      it("should return unsupported for version below min", () => {
        const result = checkWidgetVersion("0.1.9", config);

        expect(result.status).toBe("unsupported");
        expect(result.canContinue).toBe(false);
        expect(result.message).toContain("0.1.9");
        expect(result.message).toContain("no longer supported");
        expect(result.minVersion).toBe("0.2.0");
      });

      it("should use custom warning message if provided", () => {
        const customConfig: BridgeServerConfig = {
          ...config,
          versionWarningMessage: "Please update your widget!",
        };

        const result = checkWidgetVersion("0.1.0", customConfig);

        expect(result.message).toBe("Please update your widget!");
      });
    });

    describe("with latestWidgetVersion", () => {
      const config: BridgeServerConfig = {
        port: 3001,
        latestWidgetVersion: "1.2.0",
      };

      it("should return ok for version equal to latest", () => {
        const result = checkWidgetVersion("1.2.0", config);

        expect(result.status).toBe("ok");
        expect(result.canContinue).toBe(true);
      });

      it("should return ok for version above latest", () => {
        const result = checkWidgetVersion("1.3.0", config);

        expect(result.status).toBe("ok");
        expect(result.canContinue).toBe(true);
      });

      it("should return outdated for minor version behind", () => {
        const result = checkWidgetVersion("1.1.0", config);

        expect(result.status).toBe("outdated");
        expect(result.canContinue).toBe(true);
        expect(result.message).toContain("1.2.0");
        expect(result.latestVersion).toBe("1.2.0");
      });

      it("should return outdated for patch version behind", () => {
        const patchConfig: BridgeServerConfig = {
          port: 3001,
          latestWidgetVersion: "1.2.1",
        };
        const result = checkWidgetVersion("1.2.0", patchConfig);

        expect(result.status).toBe("outdated");
        expect(result.canContinue).toBe(true);
      });

      it("should return deprecated for major version behind", () => {
        const result = checkWidgetVersion("0.9.0", config);

        expect(result.status).toBe("deprecated");
        expect(result.canContinue).toBe(true);
        expect(result.message).toContain("deprecated");
      });
    });

    describe("with both minWidgetVersion and latestWidgetVersion", () => {
      const config: BridgeServerConfig = {
        port: 3001,
        minWidgetVersion: "0.2.0",
        latestWidgetVersion: "1.0.0",
      };

      it("should return unsupported for version below min (takes precedence)", () => {
        const result = checkWidgetVersion("0.1.0", config);

        expect(result.status).toBe("unsupported");
        expect(result.canContinue).toBe(false);
      });

      it("should return deprecated for version above min but major behind latest", () => {
        const result = checkWidgetVersion("0.5.0", config);

        expect(result.status).toBe("deprecated");
        expect(result.canContinue).toBe(true);
      });

      it("should return ok for version at latest", () => {
        const result = checkWidgetVersion("1.0.0", config);

        expect(result.status).toBe("ok");
        expect(result.canContinue).toBe(true);
      });
    });

    describe("version parsing", () => {
      const config: BridgeServerConfig = {
        port: 3001,
        minWidgetVersion: "1.0.0",
        latestWidgetVersion: "2.0.0",
      };

      it("should handle versions with v prefix", () => {
        const result = checkWidgetVersion("v1.5.0", config);

        expect(result.status).toBe("deprecated");
        expect(result.canContinue).toBe(true);
      });

      it("should handle two-part versions", () => {
        const result = checkWidgetVersion("2.0", config);

        expect(result.status).toBe("ok");
        expect(result.canContinue).toBe(true);
      });
    });
  });

  describe("getVersionHeaders", () => {
    it("should return empty object for ok status", () => {
      const result: VersionCheckResult = {
        status: "ok",
        canContinue: true,
      };

      const headers = getVersionHeaders(result);

      expect(Object.keys(headers).length).toBe(0);
    });

    it("should include status header for non-ok status", () => {
      const result: VersionCheckResult = {
        status: "outdated",
        canContinue: true,
      };

      const headers = getVersionHeaders(result);

      expect(headers["X-PocketPing-Version-Status"]).toBe("outdated");
    });

    it("should include min version when present", () => {
      const result: VersionCheckResult = {
        status: "unsupported",
        minVersion: "0.5.0",
        canContinue: false,
      };

      const headers = getVersionHeaders(result);

      expect(headers["X-PocketPing-Min-Version"]).toBe("0.5.0");
    });

    it("should include latest version when present", () => {
      const result: VersionCheckResult = {
        status: "outdated",
        latestVersion: "1.0.0",
        canContinue: true,
      };

      const headers = getVersionHeaders(result);

      expect(headers["X-PocketPing-Latest-Version"]).toBe("1.0.0");
    });

    it("should include message when present", () => {
      const result: VersionCheckResult = {
        status: "deprecated",
        message: "Please update your widget",
        canContinue: true,
      };

      const headers = getVersionHeaders(result);

      expect(headers["X-PocketPing-Version-Message"]).toBe("Please update your widget");
    });

    it("should include all headers when all fields present", () => {
      const result: VersionCheckResult = {
        status: "deprecated",
        message: "Update required",
        minVersion: "0.2.0",
        latestVersion: "1.0.0",
        canContinue: true,
      };

      const headers = getVersionHeaders(result);

      expect(headers["X-PocketPing-Version-Status"]).toBe("deprecated");
      expect(headers["X-PocketPing-Min-Version"]).toBe("0.2.0");
      expect(headers["X-PocketPing-Latest-Version"]).toBe("1.0.0");
      expect(headers["X-PocketPing-Version-Message"]).toBe("Update required");
    });
  });
});
