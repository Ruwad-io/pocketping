import { beforeEach, describe, expect, it } from 'vitest';
import { PocketPing } from '../src/pocketping';

describe('Version Management', () => {
  describe('checkWidgetVersion', () => {
    describe('without version constraints', () => {
      let pp: PocketPing;

      beforeEach(() => {
        pp = new PocketPing();
      });

      it('should return ok status when no version provided', () => {
        const result = pp.checkWidgetVersion(undefined);

        expect(result.status).toBe('ok');
        expect(result.canContinue).toBe(true);
      });

      it('should return ok status when version provided but no constraints', () => {
        const result = pp.checkWidgetVersion('1.0.0');

        expect(result.status).toBe('ok');
        expect(result.canContinue).toBe(true);
      });
    });

    describe('with minWidgetVersion', () => {
      let pp: PocketPing;

      beforeEach(() => {
        pp = new PocketPing({
          minWidgetVersion: '0.2.0',
        });
      });

      it('should return ok for version equal to min', () => {
        const result = pp.checkWidgetVersion('0.2.0');

        expect(result.status).toBe('ok');
        expect(result.canContinue).toBe(true);
      });

      it('should return ok for version above min', () => {
        const result = pp.checkWidgetVersion('0.3.0');

        expect(result.status).toBe('ok');
        expect(result.canContinue).toBe(true);
      });

      it('should return unsupported for version below min', () => {
        const result = pp.checkWidgetVersion('0.1.9');

        expect(result.status).toBe('unsupported');
        expect(result.canContinue).toBe(false);
        expect(result.message).toContain('0.1.9');
        expect(result.message).toContain('no longer supported');
        expect(result.minVersion).toBe('0.2.0');
      });

      it('should use custom warning message if provided', () => {
        const ppCustom = new PocketPing({
          minWidgetVersion: '0.2.0',
          versionWarningMessage: 'Please update your widget!',
        });

        const result = ppCustom.checkWidgetVersion('0.1.0');

        expect(result.message).toBe('Please update your widget!');
      });
    });

    describe('with latestWidgetVersion', () => {
      let pp: PocketPing;

      beforeEach(() => {
        pp = new PocketPing({
          latestWidgetVersion: '1.2.0',
        });
      });

      it('should return ok for version equal to latest', () => {
        const result = pp.checkWidgetVersion('1.2.0');

        expect(result.status).toBe('ok');
        expect(result.canContinue).toBe(true);
      });

      it('should return ok for version above latest', () => {
        const result = pp.checkWidgetVersion('1.3.0');

        expect(result.status).toBe('ok');
        expect(result.canContinue).toBe(true);
      });

      it('should return outdated for minor version behind', () => {
        const result = pp.checkWidgetVersion('1.1.0');

        expect(result.status).toBe('outdated');
        expect(result.canContinue).toBe(true);
        expect(result.message).toContain('1.2.0');
        expect(result.latestVersion).toBe('1.2.0');
      });

      it('should return outdated for patch version behind', () => {
        const _result = pp.checkWidgetVersion('1.2.0');
        const ppPatch = new PocketPing({ latestWidgetVersion: '1.2.1' });
        const resultPatch = ppPatch.checkWidgetVersion('1.2.0');

        expect(resultPatch.status).toBe('outdated');
        expect(resultPatch.canContinue).toBe(true);
      });

      it('should return deprecated for major version behind', () => {
        const result = pp.checkWidgetVersion('0.9.0');

        expect(result.status).toBe('deprecated');
        expect(result.canContinue).toBe(true);
        expect(result.message).toContain('deprecated');
      });
    });

    describe('with both minWidgetVersion and latestWidgetVersion', () => {
      let pp: PocketPing;

      beforeEach(() => {
        pp = new PocketPing({
          minWidgetVersion: '0.2.0',
          latestWidgetVersion: '1.0.0',
        });
      });

      it('should return unsupported for version below min (takes precedence)', () => {
        const result = pp.checkWidgetVersion('0.1.0');

        expect(result.status).toBe('unsupported');
        expect(result.canContinue).toBe(false);
      });

      it('should return deprecated for version above min but major behind latest', () => {
        const result = pp.checkWidgetVersion('0.5.0');

        expect(result.status).toBe('deprecated');
        expect(result.canContinue).toBe(true);
      });

      it('should return ok for version at latest', () => {
        const result = pp.checkWidgetVersion('1.0.0');

        expect(result.status).toBe('ok');
        expect(result.canContinue).toBe(true);
      });
    });

    describe('version parsing', () => {
      let pp: PocketPing;

      beforeEach(() => {
        pp = new PocketPing({
          minWidgetVersion: '1.0.0',
          latestWidgetVersion: '2.0.0',
        });
      });

      it('should handle versions with v prefix', () => {
        const result = pp.checkWidgetVersion('v1.5.0');

        expect(result.status).toBe('deprecated'); // Major behind
        expect(result.canContinue).toBe(true);
      });

      it('should handle two-part versions', () => {
        const result = pp.checkWidgetVersion('2.0');

        expect(result.status).toBe('ok');
        expect(result.canContinue).toBe(true);
      });

      it('should handle pre-release versions', () => {
        const result = pp.checkWidgetVersion('2.0.0-beta.1');

        expect(result.status).toBe('ok');
        expect(result.canContinue).toBe(true);
      });
    });
  });

  describe('version result structure', () => {
    it('should include all version info in result', () => {
      const pp = new PocketPing({
        minWidgetVersion: '0.2.0',
        latestWidgetVersion: '1.0.0',
      });

      const result = pp.checkWidgetVersion('0.3.0');

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('canContinue');
      expect(result.minVersion).toBe('0.2.0');
      expect(result.latestVersion).toBe('1.0.0');
    });
  });
});
