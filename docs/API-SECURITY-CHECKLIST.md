# API Security Checklist

**Purpose**: Ensure all API endpoints meet security standards before deployment  
**Usage**: Review this checklist for every new endpoint and during security audits

## 🔐 **Authentication & Authorization**

### JWT Authentication

- [ ] **JWT validation implemented** where required using `withJwtAuth` or `withApiMiddleware`
- [ ] **Token expiration properly handled** with appropriate error responses
- [ ] **Token refresh mechanism** works correctly for long-running sessions
- [ ] **Authorization levels verified** (public, authenticated, admin, sudo)

### Cookie Security

- [ ] **HttpOnly cookies** used for sensitive tokens (siteAuth, sudo)
- [ ] **Secure flag set** for cookies in production
- [ ] **SameSite protection** configured (`strict` or `lax`)
- [ ] **Cookie expiration** set appropriately

### Admin/Privileged Operations

- [ ] **Sudo mode required** for sensitive administrative operations
- [ ] **Role-based access control** implemented where needed
- [ ] **IP validation** for sudo operations (if applicable)
- [ ] **Multi-factor authentication** considered for critical operations

## 🚦 **Rate Limiting & DDoS Protection**

### Rate Limiting Implementation

- [ ] **Rate limiting applied** using `genericRateLimiter`
- [ ] **Appropriate limits set** based on endpoint sensitivity:
  - Authentication: 5 requests/15min
  - Public APIs: 20-50 requests/5min
  - Admin APIs: 10 requests/5min
  - File operations: 10 requests/1min
- [ ] **Rate limit naming** follows convention: `{endpoint-name}-api`
- [ ] **Rate limit responses** handled gracefully

### DDoS Considerations

- [ ] **Endpoint cannot be easily abused** for resource exhaustion
- [ ] **Expensive operations protected** with stricter rate limits
- [ ] **Caching implemented** where appropriate to reduce load

## 🔍 **Input Validation & Sanitization**

### Request Validation

- [ ] **HTTP method restrictions** enforced (`GET`, `POST`, etc.)
- [ ] **Content-Type validation** for POST requests
- [ ] **Request body size limits** considered
- [ ] **Required fields validated** with appropriate error messages

### Data Sanitization

- [ ] **XSS prevention**: HTML content sanitized
- [ ] **SQL injection prevention**: Parameterized queries used
- [ ] **Input length limits** enforced
- [ ] **Type validation**: Ensure strings are strings, numbers are numbers
- [ ] **Email validation** for email fields
- [ ] **URL validation** for URL fields

### File Operations

- [ ] **File type validation** implemented (extensions and MIME types)
- [ ] **File size limits** enforced
- [ ] **Path traversal prevention** (no `../` in file paths)
- [ ] **Content verification** for uploaded/requested files

## 🌐 **CORS & Origin Protection**

### CORS Configuration

- [ ] **Origin validation** implemented for production
- [ ] **Allowed methods** explicitly defined
- [ ] **Allowed headers** restricted to necessary ones
- [ ] **Credentials handling** configured appropriately
- [ ] **Preflight requests** handled correctly

### Origin Security

- [ ] **Referer validation** for sensitive operations
- [ ] **Host header validation** implemented
- [ ] **Development vs production** origin handling

## 🛡️ **Error Handling & Information Disclosure**

### Error Responses

- [ ] **Generic error messages** in production (no stack traces)
- [ ] **Appropriate HTTP status codes** used
- [ ] **Consistent error format** across endpoints
- [ ] **No sensitive information** leaked in error messages

### Logging & Monitoring

- [ ] **Security events logged** (auth failures, rate limits, etc.)
- [ ] **Error logging** implemented for debugging
- [ ] **No sensitive data** logged (passwords, tokens, PII)
- [ ] **Log rotation** configured

## 🔒 **Data Protection & Privacy**

### Sensitive Data Handling

- [ ] **PII protection**: Personal information properly handled
- [ ] **Password hashing**: bcrypt used for password storage
- [ ] **Token security**: Tokens not logged or exposed
- [ ] **Database security**: Firestore rules properly configured

### Data Transmission

- [ ] **HTTPS enforced** in production
- [ ] **Sensitive data encrypted** in transit
- [ ] **No sensitive data in URLs** (use POST body instead)

## 🧪 **Testing & Quality Assurance**

### Security Testing

- [ ] **Unit tests** for authentication logic
- [ ] **Rate limiting tests** implemented
- [ ] **Input validation tests** cover edge cases
- [ ] **Error handling tests** verify no information leakage

### Integration Testing

- [ ] **End-to-end authentication** flows tested
- [ ] **CORS handling** tested with different origins
- [ ] **Rate limiting** tested under load
- [ ] **Error scenarios** tested

## 📋 **Documentation & Compliance**

### API Documentation

- [ ] **Security requirements** documented
- [ ] **Rate limits** documented
- [ ] **Error responses** documented
- [ ] **Authentication flow** explained

### Compliance

- [ ] **OWASP Top 10** vulnerabilities addressed
- [ ] **Security review** completed
- [ ] **Penetration testing** considered for critical endpoints

## 🚀 **Deployment & Infrastructure**

### Environment Configuration

- [ ] **Environment variables** properly configured
- [ ] **Secrets management** implemented (no hardcoded secrets)
- [ ] **Production vs development** configurations separated

### Infrastructure Security

- [ ] **Database security rules** deployed
- [ ] **CDN/proxy configuration** secured
- [ ] **SSL/TLS certificates** valid and current

## ✅ **Security Patterns & Examples**

### Recommended Middleware Stack

```typescript
// For public endpoints with basic security
export default withApiMiddleware(handler);

// For authenticated endpoints
export default withApiMiddleware(withJwtAuth(handler));

// For admin endpoints requiring sudo
export default withApiMiddleware(withJwtAuth(handler)); // + sudo check in handler

// For JWT-only endpoints (no siteAuth cookie required)
export default withJwtOnlyAuth(handler);
```

### Rate Limiting Examples

```typescript
// Standard API endpoint
const isAllowed = await genericRateLimiter(req, res, {
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 requests per 5 minutes
  name: "my-endpoint-api",
});

// Sensitive authentication endpoint
const isAllowed = await genericRateLimiter(req, res, {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per 15 minutes
  name: "auth-api",
});
```

### Input Validation Examples

```typescript
// String validation
if (!input || typeof input !== "string" || input.length > 1000) {
  return res.status(400).json({ error: "Invalid input" });
}

// Email validation
if (!validator.isEmail(email)) {
  return res.status(400).json({ error: "Invalid email format" });
}

// File type validation
if (!filename.toLowerCase().endsWith(".pdf")) {
  return res.status(400).json({ error: "Only PDF files allowed" });
}
```

## 🔍 **Security Review Process**

### Pre-Deployment Checklist

1. [ ] **All checklist items** reviewed and implemented
2. [ ] **Security tests** passing
3. [ ] **Code review** completed with security focus
4. [ ] **Documentation** updated

### Post-Deployment Monitoring

1. [ ] **Security alerts** configured
2. [ ] **Rate limiting** monitored for abuse patterns
3. [ ] **Error rates** monitored for unusual activity
4. [ ] **Regular security audits** scheduled

---

## 📞 **Security Incident Response**

If security issues are discovered:

1. **Immediate**: Disable affected endpoint if critical
2. **Assessment**: Evaluate impact and scope
3. **Fix**: Implement security patch
4. **Testing**: Verify fix doesn't break functionality
5. **Deploy**: Roll out fix with monitoring
6. **Review**: Post-incident analysis and prevention

---

**Remember**: Security is not a one-time implementation but an ongoing process. Regular reviews and updates are
essential for maintaining a secure API.
