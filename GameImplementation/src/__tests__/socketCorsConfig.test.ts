import { parseAllowedOrigins, resolveSocketCorsOrigin } from '../socketCorsConfig';

describe('socketCorsConfig', () => {
  it('parses comma-separated allowed origins', () => {
    expect(parseAllowedOrigins('https://beta.example.com, https://app.example.com')).toEqual([
      'https://beta.example.com',
      'https://app.example.com',
    ]);
  });

  it('allows localhost origins in non-production when no explicit origins are configured', () => {
    const resolved = resolveSocketCorsOrigin('development', undefined);

    expect(resolved).toBeInstanceOf(RegExp);
    expect((resolved as RegExp).test('http://localhost:5173')).toBe(true);
    expect((resolved as RegExp).test('http://127.0.0.1:4173')).toBe(true);
    expect((resolved as RegExp).test('https://beta.example.com')).toBe(false);
  });

  it('requires explicit origins in production', () => {
    expect(resolveSocketCorsOrigin('production', undefined)).toEqual([]);
    expect(resolveSocketCorsOrigin('production', 'https://beta.example.com')).toEqual([
      'https://beta.example.com',
    ]);
  });
});
