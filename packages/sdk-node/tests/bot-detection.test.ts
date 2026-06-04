import { describe, expect, it } from 'vitest';
import {
  detectBot,
  isDatacenterIp,
  isHeadlessUserAgent,
  isHostingOrg,
} from '../src/utils/bot-detection';

describe('bot-detection', () => {
  describe('isDatacenterIp', () => {
    it('flags known datacenter IPv4 addresses', () => {
      expect(isDatacenterIp('34.72.176.129')).toBe(true); // Google Cloud
      expect(isDatacenterIp('51.75.1.1')).toBe(true); // OVH
      expect(isDatacenterIp('5.9.1.1')).toBe(true); // Hetzner
      expect(isDatacenterIp('159.65.1.1')).toBe(true); // DigitalOcean
    });

    it('flags known datacenter IPv6 addresses', () => {
      expect(isDatacenterIp('2001:41d0:350:1400::1')).toBe(true); // OVH
      expect(isDatacenterIp('[2a01:4f8::1]')).toBe(true); // Hetzner, bracketed
      expect(isDatacenterIp('2a01:4ff::1')).toBe(true); // Hetzner /29 upper bound
      expect(isDatacenterIp('::ffff:34.72.176.129')).toBe(true); // IPv4-mapped IPv6
    });

    it('does not flag residential / unknown / garbage IPs', () => {
      expect(isDatacenterIp('8.8.8.8')).toBe(false);
      expect(isDatacenterIp('192.168.1.10')).toBe(false);
      expect(isDatacenterIp('unknown')).toBe(false);
      expect(isDatacenterIp('')).toBe(false);
      expect(isDatacenterIp(null)).toBe(false);
      expect(isDatacenterIp(undefined)).toBe(false);
      expect(isDatacenterIp('not-an-ip')).toBe(false);
      expect(isDatacenterIp('999.999.999.999')).toBe(false);
    });
  });

  describe('isHeadlessUserAgent', () => {
    it('flags obvious automation / headless markers', () => {
      expect(isHeadlessUserAgent('Mozilla/5.0 (X11) HeadlessChrome/120.0.0.0 Safari/537.36')).toBe(
        true
      );
      expect(isHeadlessUserAgent('python-requests/2.31.0')).toBe(true);
      expect(isHeadlessUserAgent('curl/8.4.0')).toBe(true);
    });

    it('does not flag a real Chrome UA', () => {
      expect(
        isHeadlessUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
      ).toBe(false);
      expect(isHeadlessUserAgent('')).toBe(false);
      expect(isHeadlessUserAgent(null)).toBe(false);
      expect(isHeadlessUserAgent(undefined)).toBe(false);
    });
  });

  describe('isHostingOrg', () => {
    it('flags unambiguous hosting providers', () => {
      expect(isHostingOrg('Hetzner Online GmbH')).toBe(true);
      expect(isHostingOrg('DigitalOcean, LLC')).toBe(true);
      expect(isHostingOrg('Vultr Holdings, LLC')).toBe(true);
    });

    it('does NOT flag broad consumer brands or non-hosting orgs', () => {
      expect(isHostingOrg('Google Fiber Inc.')).toBe(false);
      expect(isHostingOrg('Google LLC')).toBe(false);
      expect(isHostingOrg('AMAZON-02')).toBe(false);
      expect(isHostingOrg('Orange S.A.')).toBe(false);
      expect(isHostingOrg('')).toBe(false);
      expect(isHostingOrg(null)).toBe(false);
      expect(isHostingOrg(undefined)).toBe(false);
    });
  });

  describe('detectBot', () => {
    it('flags a datacenter IP with reason datacenter_ip', () => {
      expect(detectBot({ ip: '34.72.176.129' })).toEqual({
        isBot: true,
        reason: 'datacenter_ip',
      });
    });

    it('flags a hosting ASN with reason hosting_asn', () => {
      expect(detectBot({ ip: '8.8.8.8', org: 'Hetzner Online GmbH' })).toEqual({
        isBot: true,
        reason: 'hosting_asn',
      });
    });

    it('flags a headless UA with reason headless_ua', () => {
      expect(
        detectBot({
          ip: '8.8.8.8',
          userAgent: 'HeadlessChrome/120.0.0.0',
        })
      ).toEqual({ isBot: true, reason: 'headless_ua' });
    });

    it('does not flag a clean residential connection', () => {
      expect(
        detectBot({
          ip: '8.8.8.8',
          org: 'Orange S.A.',
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        })
      ).toEqual({ isBot: false, reason: null });
    });

    it('prioritizes datacenter_ip over other signals', () => {
      expect(
        detectBot({
          ip: '5.9.1.1',
          org: 'Hetzner Online GmbH',
          userAgent: 'curl/8.4.0',
        })
      ).toEqual({ isBot: true, reason: 'datacenter_ip' });
    });
  });
});
