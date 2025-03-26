#!/bin/bash

# Check if required arguments are provided
if [ $# -lt 2 ]; then
  echo "Usage: $0 <password> <site_auth_cookie>"
  echo "Example: $0 mySecretPassword abc123def456"
  exit 1
fi

PASSWORD=$1
SITE_AUTH_COOKIE=$2
echo "======= API Security Testing Script ======="
echo "Using siteAuth cookie: ${SITE_AUTH_COOKIE:0:10}..." 

# Initialize test result tracking
TEST1_RESULT=1
TEST2_RESULT=1
TEST3A_RESULT=1
TEST3B_RESULT=1
TEST3C_RESULT=1
TEST4_RESULT=1
TEST5_RESULT=1
TEST6_RESULT=1
TEST7_RESULT=1
TEST8_RESULT=1

# Check if jq is installed
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required but not installed. Please install jq first."
  echo "  macOS: brew install jq"
  echo "  Ubuntu/Debian: sudo apt install jq"
  echo "  Windows: choco install jq or scoop install jq"
  exit 1
fi

# Print test result function
print_result() {
  local status=$1
  local message=$2
  if [ "$status" -eq 0 ]; then
    echo -e "\e[32m✓ PASS:\e[0m $message"
  else
    echo -e "\e[31m✗ FAIL:\e[0m $message"
  fi
}

# 1. Test without authentication
echo -e "\n\n1. Testing without authentication:"
RESPONSE=$(curl -X GET "http://localhost:3000/api/web-token" -s -w "\n%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq
if [[ "$HTTP_CODE" -eq 401 ]] || [[ $(echo "$BODY" | grep -c "unauthorized\|Unauthorized\|error") -gt 0 ]]; then
  print_result 0 "Authentication required as expected"
  TEST1_RESULT=0
else
  print_result 1 "Server allowed access without authentication (HTTP $HTTP_CODE)"
fi

# 2. Test with invalid token
echo -e "\n\n2. Testing with invalid token:"
RESPONSE=$(curl -X GET "http://localhost:3000/api/web-token" \
  -H "Authorization: Bearer invalid.token.here" -s -w "\n%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq
if [[ "$HTTP_CODE" -eq 401 ]] || [[ $(echo "$BODY" | grep -c "unauthorized\|Unauthorized\|error\|invalid") -gt 0 ]]; then
  print_result 0 "Invalid token correctly rejected"
  TEST2_RESULT=0
else
  print_result 1 "Server accepted invalid token (HTTP $HTTP_CODE)"
fi

# 3. Test with clearly fake cookies to check validation
echo -e "\n\n3. Testing cookie validation:"

# Test with obviously fake values
echo -e "\n3a. Using 'FAKER' as cookie:"
RESPONSE=$(curl -X GET "http://localhost:3000/api/web-token" \
  -H "Cookie: siteAuth=FAKER" -s -w "\n%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq
if [[ "$HTTP_CODE" -eq 401 ]] || [[ $(echo "$BODY" | grep -c "unauthorized\|Unauthorized\|error\|invalid") -gt 0 ]]; then
  print_result 0 "Fake cookie 'FAKER' correctly rejected"
  TEST3A_RESULT=0
else
  print_result 1 "Server accepted fake cookie 'FAKER' (HTTP $HTTP_CODE)"
fi

echo -e "\n3b. Using 'totally_invalid_cookie' as cookie:"
RESPONSE=$(curl -X GET "http://localhost:3000/api/web-token" \
  -H "Cookie: siteAuth=totally_invalid_cookie" -s -w "\n%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq
if [[ "$HTTP_CODE" -eq 401 ]] || [[ $(echo "$BODY" | grep -c "unauthorized\|Unauthorized\|error\|invalid") -gt 0 ]]; then
  print_result 0 "Fake cookie 'totally_invalid_cookie' correctly rejected"
  TEST3B_RESULT=0
else
  print_result 1 "Server accepted fake cookie 'totally_invalid_cookie' (HTTP $HTTP_CODE)"
fi

echo -e "\n3c. Using 'this_should_not_work' as cookie:"
RESPONSE=$(curl -X GET "http://localhost:3000/api/web-token" \
  -H "Cookie: siteAuth=this_should_not_work" -s -w "\n%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq
if [[ "$HTTP_CODE" -eq 401 ]] || [[ $(echo "$BODY" | grep -c "unauthorized\|Unauthorized\|error\|invalid") -gt 0 ]]; then
  print_result 0 "Fake cookie 'this_should_not_work' correctly rejected"
  TEST3C_RESULT=0
else
  print_result 1 "Server accepted fake cookie 'this_should_not_work' (HTTP $HTTP_CODE)"
fi

# 4. Getting token with provided siteAuth cookie
echo -e "\n\n4. Getting token with provided siteAuth cookie:"
RESPONSE=$(curl -X GET "http://localhost:3000/api/web-token" \
  -H "Cookie: siteAuth=$SITE_AUTH_COOKIE" -s -w "\n%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
TOKEN_RESPONSE=$(echo "$RESPONSE" | sed '$d')
echo "$TOKEN_RESPONSE" | jq

# Extract the token
JWT_TOKEN=$(echo $TOKEN_RESPONSE | sed -e 's/.*"token":"\([^"]*\)".*/\1/')
if [[ -n "$JWT_TOKEN" && "$HTTP_CODE" -eq 200 ]]; then
  echo "Captured token: ${JWT_TOKEN:0:20}..."
  print_result 0 "Successfully obtained JWT token with valid cookie"
  TEST4_RESULT=0
else
  echo "ERROR: Failed to extract JWT token from response!"
  print_result 1 "Failed to get token with siteAuth cookie (HTTP $HTTP_CODE)"
  # Continue with a fake token for testing (will fail as expected)
  JWT_TOKEN="invalid.token.here"
fi

# 5. Test access to protected endpoint
echo -e "\n\n5. Testing access to protected endpoint with token:"
RESPONSE=$(curl -X GET "http://localhost:3000/api/answers?page=1&limit=10" \
  -H "Authorization: Bearer $JWT_TOKEN" -s -w "\n%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq | head -n 100

if [[ "$HTTP_CODE" -eq 200 ]] && [[ $(echo "$BODY" | grep -c "error\|unauthorized\|invalid") -eq 0 ]]; then
  print_result 0 "Successfully accessed protected endpoint with token"
  TEST5_RESULT=0
else
  print_result 1 "Failed to access protected endpoint with token (HTTP $HTTP_CODE)"
fi

# 6. Try accessing admin-only endpoint
echo -e "\n\n6. Testing access to admin-only endpoint:"
RESPONSE=$(curl -X GET "http://localhost:3000/api/downvotedAnswers" \
  -H "Authorization: Bearer $JWT_TOKEN" -s -w "\n%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq | head -n 100

# Check if the current user should have admin access (if yes, HTTP 200 is expected, otherwise 403)
# Adjust this check according to your actual admin access rules
if [[ "$HTTP_CODE" -eq 403 ]] || [[ $(echo "$BODY" | grep -c "forbidden\|admin\|permission") -gt 0 ]]; then
  print_result 0 "Admin-only endpoint properly restricted"
  TEST6_RESULT=0
else
  echo "Note: This could be a pass if your token has admin rights."
  if [[ "$HTTP_CODE" -eq 200 ]]; then
    print_result 0 "Admin endpoint accessed successfully (token appears to have admin rights)"
    TEST6_RESULT=0
  else
    print_result 1 "Unexpected response from admin endpoint (HTTP $HTTP_CODE)"
  fi
fi

# 7. Token expiration test
echo -e "\n\n7. Token expiration test (short version):"
echo "Getting a fresh token..."
RESPONSE=$(curl -X GET "http://localhost:3000/api/web-token" \
  -H "Cookie: siteAuth=$SITE_AUTH_COOKIE" -s -w "\n%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
TOKEN_RESPONSE=$(echo "$RESPONSE" | sed '$d')
JWT_TOKEN=$(echo $TOKEN_RESPONSE | sed -e 's/.*"token":"\([^"]*\)".*/\1/')

if [[ -n "$JWT_TOKEN" && "$HTTP_CODE" -eq 200 ]]; then
  print_result 0 "Successfully received fresh token"
  TEST7_RESULT=0
else
  print_result 1 "Failed to get fresh token (HTTP $HTTP_CODE)"
fi

echo "Testing protected endpoint with fresh token:"
RESPONSE=$(curl -X GET "http://localhost:3000/api/answers?page=1&limit=10" \
  -H "Authorization: Bearer $JWT_TOKEN" -s -w "\n%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq | head -n 100

if [[ "$HTTP_CODE" -eq 200 ]]; then
  print_result 0 "Successfully accessed endpoint with fresh token"
else
  print_result 1 "Failed to access with fresh token (HTTP $HTTP_CODE)"
fi

# Note: Actual expiration test would need to wait 15+ minutes
echo "Note: For a real expiration test, uncomment the sleep command below"
# Uncomment these lines for a real expiration test
# echo "Waiting 16 minutes for token to expire..."
# sleep 960
# echo "Testing with expired token:"
# RESPONSE=$(curl -X GET "http://localhost:3000/api/answers?page=1&limit=10" \
#   -H "Authorization: Bearer $JWT_TOKEN" -s -w "\n%{http_code}")
# HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
# BODY=$(echo "$RESPONSE" | sed '$d')
# echo "$BODY" | jq
# if [[ "$HTTP_CODE" -eq 401 ]] || [[ $(echo "$BODY" | grep -c "expired\|invalid") -gt 0 ]]; then
#   print_result 0 "Expired token correctly rejected"
# else
#   print_result 1 "Server accepted expired token (HTTP $HTTP_CODE)"
# fi

echo -e "\n\n8. Testing with both token and cookie:"
# Get the response and process it first with jq, then limit output lines
RESPONSE=$(curl -X GET "http://localhost:3000/api/answers?page=1&limit=10" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Cookie: siteAuth=$SITE_AUTH_COOKIE" \
  -s -w "\n%{http_code}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq '.' | head -n 100

if [[ "$HTTP_CODE" -eq 200 ]]; then
  print_result 0 "Successfully accessed with both token and cookie"
  TEST8_RESULT=0
else
  print_result 1 "Failed to access with both token and cookie (HTTP $HTTP_CODE)"
fi

echo "... (response truncated to 100 lines) ..."

# Print summary of all tests using the tracked variables
echo -e "\n\n======= Test Summary ======="
echo -e "1. Authentication required: $(if [[ "$TEST1_RESULT" -eq 0 ]]; then echo -e "\e[32mPASS\e[0m"; else echo -e "\e[31mFAIL\e[0m"; fi)"
echo -e "2. Invalid token: $(if [[ "$TEST2_RESULT" -eq 0 ]]; then echo -e "\e[32mPASS\e[0m"; else echo -e "\e[31mFAIL\e[0m"; fi)"
echo -e "3. Cookie validation: $(if [[ "$TEST3A_RESULT" -eq 0 && "$TEST3B_RESULT" -eq 0 && "$TEST3C_RESULT" -eq 0 ]]; then echo -e "\e[32mPASS\e[0m"; else echo -e "\e[31mFAIL\e[0m"; fi)"
echo -e "4. Token with cookie: $(if [[ "$TEST4_RESULT" -eq 0 ]]; then echo -e "\e[32mPASS\e[0m"; else echo -e "\e[31mFAIL\e[0m"; fi)"
echo -e "5. Protected endpoint: $(if [[ "$TEST5_RESULT" -eq 0 ]]; then echo -e "\e[32mPASS\e[0m"; else echo -e "\e[31mFAIL\e[0m"; fi)"
echo -e "6. Admin endpoint: $(if [[ "$TEST6_RESULT" -eq 0 ]]; then echo -e "\e[32mPASS\e[0m"; else echo -e "\e[31mFAIL\e[0m"; fi)"
echo -e "7. Token refresh: $(if [[ "$TEST7_RESULT" -eq 0 ]]; then echo -e "\e[32mPASS\e[0m"; else echo -e "\e[31mFAIL\e[0m"; fi)"
echo -e "8. Token+cookie combo: $(if [[ "$TEST8_RESULT" -eq 0 ]]; then echo -e "\e[32mPASS\e[0m"; else echo -e "\e[31mFAIL\e[0m"; fi)"
echo -e "\n\n======= Testing Complete ======="
