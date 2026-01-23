import { describe, it, expect } from 'vitest';
import {
  ipToNumber,
  parseCidr,
  ipMatchesCidr,
  ipMatchesAny,
  shouldAllowIp,
  checkIpFilter,
  type IpFilterConfig,
} from '../src/utils/ip-filter';

describe('IP Filter Utilities', () => {
  describe('ipToNumber', () => {
    it('should parse valid IPv4 addresses', () => {
      expect(ipToNumber('0.0.0.0')).toBe(0);
      expect(ipToNumber('255.255.255.255')).toBe(4294967295);
      expect(ipToNumber('192.168.1.1')).toBe(3232235777);
      expect(ipToNumber('10.0.0.1')).toBe(167772161);
    });

    it('should return null for invalid IPs', () => {
      expect(ipToNumber('invalid')).toBe(null);
      expect(ipToNumber('256.1.1.1')).toBe(null);
      expect(ipToNumber('1.2.3')).toBe(null);
      expect(ipToNumber('1.2.3.4.5')).toBe(null);
      expect(ipToNumber('')).toBe(null);
      expect(ipToNumber('a.b.c.d')).toBe(null);
      expect(ipToNumber('1.2.3.-1')).toBe(null);
    });
  });

  describe('parseCidr', () => {
    it('should parse CIDR notation', () => {
      const result = parseCidr('192.168.1.0/24');
      expect(result).not.toBe(null);
      expect(result?.mask).toBe(4294967040); // 255.255.255.0
    });

    it('should parse single IP as /32', () => {
      const result = parseCidr('192.168.1.1');
      expect(result).not.toBe(null);
      expect(result?.mask).toBe(4294967295); // 255.255.255.255
    });

    it('should handle /0 (all IPs)', () => {
      const result = parseCidr('0.0.0.0/0');
      expect(result).not.toBe(null);
      expect(result?.mask).toBe(0);
    });

    it('should return null for invalid CIDR', () => {
      expect(parseCidr('invalid/24')).toBe(null);
      expect(parseCidr('192.168.1.0/33')).toBe(null);
      expect(parseCidr('192.168.1.0/-1')).toBe(null);
    });
  });

  describe('ipMatchesCidr', () => {
    it('should match exact IP', () => {
      expect(ipMatchesCidr('192.168.1.1', '192.168.1.1')).toBe(true);
      expect(ipMatchesCidr('192.168.1.2', '192.168.1.1')).toBe(false);
    });

    it('should match /24 subnet', () => {
      expect(ipMatchesCidr('192.168.1.0', '192.168.1.0/24')).toBe(true);
      expect(ipMatchesCidr('192.168.1.1', '192.168.1.0/24')).toBe(true);
      expect(ipMatchesCidr('192.168.1.255', '192.168.1.0/24')).toBe(true);
      expect(ipMatchesCidr('192.168.2.0', '192.168.1.0/24')).toBe(false);
    });

    it('should match /16 subnet', () => {
      expect(ipMatchesCidr('192.168.0.0', '192.168.0.0/16')).toBe(true);
      expect(ipMatchesCidr('192.168.255.255', '192.168.0.0/16')).toBe(true);
      expect(ipMatchesCidr('192.169.0.0', '192.168.0.0/16')).toBe(false);
    });

    it('should match /8 subnet', () => {
      expect(ipMatchesCidr('10.0.0.1', '10.0.0.0/8')).toBe(true);
      expect(ipMatchesCidr('10.255.255.255', '10.0.0.0/8')).toBe(true);
      expect(ipMatchesCidr('11.0.0.0', '10.0.0.0/8')).toBe(false);
    });

    it('should match /32 (single IP)', () => {
      expect(ipMatchesCidr('203.0.113.50', '203.0.113.50/32')).toBe(true);
      expect(ipMatchesCidr('203.0.113.51', '203.0.113.50/32')).toBe(false);
    });

    it('should match /0 (all IPs)', () => {
      expect(ipMatchesCidr('1.2.3.4', '0.0.0.0/0')).toBe(true);
      expect(ipMatchesCidr('255.255.255.255', '0.0.0.0/0')).toBe(true);
    });

    it('should return false for invalid IPs', () => {
      expect(ipMatchesCidr('invalid', '192.168.1.0/24')).toBe(false);
      expect(ipMatchesCidr('192.168.1.1', 'invalid/24')).toBe(false);
    });
  });

  describe('ipMatchesAny', () => {
    it('should match if IP is in any entry', () => {
      const list = ['192.168.1.0/24', '10.0.0.0/8', '203.0.113.50'];
      expect(ipMatchesAny('192.168.1.100', list)).toBe(true);
      expect(ipMatchesAny('10.50.25.1', list)).toBe(true);
      expect(ipMatchesAny('203.0.113.50', list)).toBe(true);
    });

    it('should return false if IP is not in any entry', () => {
      const list = ['192.168.1.0/24', '10.0.0.0/8'];
      expect(ipMatchesAny('172.16.0.1', list)).toBe(false);
      expect(ipMatchesAny('8.8.8.8', list)).toBe(false);
    });

    it('should return false for empty list', () => {
      expect(ipMatchesAny('192.168.1.1', [])).toBe(false);
    });
  });

  describe('shouldAllowIp', () => {
    describe('blocklist mode', () => {
      it('should block IPs in blocklist', () => {
        const config: IpFilterConfig = {
          enabled: true,
          mode: 'blocklist',
          blocklist: ['192.168.1.0/24', '203.0.113.0/24'],
        };
        const result = shouldAllowIp('192.168.1.50', config);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('blocklist');
      });

      it('should allow IPs not in blocklist', () => {
        const config: IpFilterConfig = {
          enabled: true,
          mode: 'blocklist',
          blocklist: ['192.168.1.0/24'],
        };
        const result = shouldAllowIp('10.0.0.1', config);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('default');
      });

      it('should allow all if blocklist is empty', () => {
        const config: IpFilterConfig = {
          enabled: true,
          mode: 'blocklist',
          blocklist: [],
        };
        const result = shouldAllowIp('192.168.1.1', config);
        expect(result.allowed).toBe(true);
      });
    });

    describe('allowlist mode', () => {
      it('should allow IPs in allowlist', () => {
        const config: IpFilterConfig = {
          enabled: true,
          mode: 'allowlist',
          allowlist: ['10.0.0.0/8', '192.168.0.0/16'],
        };
        const result = shouldAllowIp('10.0.0.50', config);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('allowlist');
      });

      it('should block IPs not in allowlist', () => {
        const config: IpFilterConfig = {
          enabled: true,
          mode: 'allowlist',
          allowlist: ['10.0.0.0/8'],
        };
        const result = shouldAllowIp('192.168.1.1', config);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('not_in_allowlist');
      });

      it('should block all if allowlist is empty', () => {
        const config: IpFilterConfig = {
          enabled: true,
          mode: 'allowlist',
          allowlist: [],
        };
        const result = shouldAllowIp('10.0.0.1', config);
        expect(result.allowed).toBe(false);
      });
    });

    describe('both mode', () => {
      it('should allow if in allowlist even if in blocklist range', () => {
        const config: IpFilterConfig = {
          enabled: true,
          mode: 'both',
          allowlist: ['10.0.0.1'],
          blocklist: ['10.0.0.0/24'],
        };
        const result = shouldAllowIp('10.0.0.1', config);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('allowlist');
      });

      it('should block if in blocklist and not in allowlist', () => {
        const config: IpFilterConfig = {
          enabled: true,
          mode: 'both',
          allowlist: ['10.0.0.1'],
          blocklist: ['10.0.0.0/24'],
        };
        const result = shouldAllowIp('10.0.0.2', config);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('blocklist');
      });

      it('should allow if not in allowlist or blocklist', () => {
        const config: IpFilterConfig = {
          enabled: true,
          mode: 'both',
          allowlist: ['10.0.0.1'],
          blocklist: ['192.168.1.0/24'],
        };
        const result = shouldAllowIp('8.8.8.8', config);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('default');
      });
    });
  });

  describe('checkIpFilter', () => {
    it('should use custom filter when provided', async () => {
      const config: IpFilterConfig = {
        enabled: true,
        mode: 'blocklist',
        blocklist: ['192.168.1.0/24'],
        customFilter: (ip) => {
          // Custom rule: block all IPs starting with "10."
          if (ip.startsWith('10.')) return false;
          return undefined; // Defer to list-based filtering
        },
      };

      // Custom filter blocks 10.x.x.x
      const result1 = await checkIpFilter('10.0.0.1', config, { path: '/test' });
      expect(result1.allowed).toBe(false);
      expect(result1.reason).toBe('custom');

      // Custom filter defers, blocklist blocks 192.168.1.x
      const result2 = await checkIpFilter('192.168.1.50', config, { path: '/test' });
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toBe('blocklist');

      // Custom filter defers, not in blocklist
      const result3 = await checkIpFilter('8.8.8.8', config, { path: '/test' });
      expect(result3.allowed).toBe(true);
      expect(result3.reason).toBe('default');
    });

    it('should handle async custom filter', async () => {
      const config: IpFilterConfig = {
        enabled: true,
        mode: 'blocklist',
        customFilter: async (ip) => {
          // Simulate async check (e.g., database lookup)
          await new Promise((resolve) => setTimeout(resolve, 1));
          return ip === '8.8.8.8' ? false : undefined;
        },
      };

      const result = await checkIpFilter('8.8.8.8', config, { path: '/test' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('custom');
    });

    it('should work without custom filter', async () => {
      const config: IpFilterConfig = {
        enabled: true,
        mode: 'blocklist',
        blocklist: ['192.168.1.0/24'],
      };

      const result = await checkIpFilter('192.168.1.50', config, { path: '/test' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('blocklist');
    });
  });
});
