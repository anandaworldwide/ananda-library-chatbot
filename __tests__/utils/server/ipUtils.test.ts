import { getClientIp } from '../../../utils/server/ipUtils';
import { NextApiRequest } from 'next';
import { NextRequest } from 'next/server';
import * as envModule from '../../../utils/env';

// Mock the isDevelopment function from env module
jest.mock('../../../utils/env', () => ({
  isDevelopment: jest.fn(),
}));

describe('ipUtils', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('getClientIp', () => {
    it('should return 127.0.0.1 in development environment', () => {
      // Mock isDevelopment to return true
      jest.spyOn(envModule, 'isDevelopment').mockReturnValue(true);

      const mockReq = {
        headers: {},
      } as unknown as NextApiRequest;

      const result = getClientIp(mockReq);
      expect(result).toBe('127.0.0.1');
    });

    it('should get IP from cf-connecting-ip header for NextApiRequest', () => {
      jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

      const mockReq = {
        headers: {
          'cf-connecting-ip': '1.2.3.4',
        },
      } as unknown as NextApiRequest;

      const result = getClientIp(mockReq);
      expect(result).toBe('1.2.3.4');
    });

    it('should get IP from cf-connecting-ip header (array) for NextApiRequest', () => {
      jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

      const mockReq = {
        headers: {
          'cf-connecting-ip': ['1.2.3.4'],
        },
      } as unknown as NextApiRequest;

      const result = getClientIp(mockReq);
      expect(result).toBe('1.2.3.4');
    });

    it('should get IP from x-forwarded-for header for NextApiRequest', () => {
      jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

      const mockReq = {
        headers: {
          'x-forwarded-for': '5.6.7.8, 9.10.11.12',
        },
      } as unknown as NextApiRequest;

      const result = getClientIp(mockReq);
      expect(result).toBe('5.6.7.8');
    });

    it('should get IP from x-forwarded-for header (array) for NextApiRequest', () => {
      jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

      const mockReq = {
        headers: {
          'x-forwarded-for': ['5.6.7.8, 9.10.11.12'],
        },
      } as unknown as NextApiRequest;

      const result = getClientIp(mockReq);
      expect(result).toBe('5.6.7.8');
    });

    it('should get IP from x-real-ip header for NextApiRequest', () => {
      jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

      const mockReq = {
        headers: {
          'x-real-ip': '13.14.15.16',
        },
      } as unknown as NextApiRequest;

      const result = getClientIp(mockReq);
      expect(result).toBe('13.14.15.16');
    });

    it('should get IP from x-real-ip header (array) for NextApiRequest', () => {
      jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

      const mockReq = {
        headers: {
          'x-real-ip': ['13.14.15.16'],
        },
      } as unknown as NextApiRequest;

      const result = getClientIp(mockReq);
      expect(result).toBe('13.14.15.16');
    });

    it('should get IP from socket.remoteAddress for NextApiRequest', () => {
      jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

      const mockReq = {
        headers: {},
        socket: {
          remoteAddress: '17.18.19.20',
        },
      } as unknown as NextApiRequest;

      const result = getClientIp(mockReq);
      expect(result).toBe('17.18.19.20');
    });

    it('should return empty string when no IP is found', () => {
      jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

      const mockReq = {
        headers: {},
        socket: {},
      } as unknown as NextApiRequest;

      const result = getClientIp(mockReq);
      expect(result).toBe('');
    });

    // NextRequest tests
    it('should get IP from cf-connecting-ip header for NextRequest', () => {
      jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

      const mockReq = {
        headers: {
          get: (name: string) =>
            name === 'cf-connecting-ip' ? '1.2.3.4' : null,
        },
      } as unknown as NextRequest;

      const result = getClientIp(mockReq);
      expect(result).toBe('1.2.3.4');
    });

    it('should get IP from x-forwarded-for header for NextRequest', () => {
      jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

      const mockReq = {
        headers: {
          get: (name: string) =>
            name === 'x-forwarded-for' ? '5.6.7.8, 9.10.11.12' : null,
        },
      } as unknown as NextRequest;

      const result = getClientIp(mockReq);
      expect(result).toBe('5.6.7.8');
    });

    it('should get IP from x-real-ip header for NextRequest', () => {
      jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

      const mockReq = {
        headers: {
          get: (name: string) => (name === 'x-real-ip' ? '13.14.15.16' : null),
        },
      } as unknown as NextRequest;

      const result = getClientIp(mockReq);
      expect(result).toBe('13.14.15.16');
    });
  });
});
