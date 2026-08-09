-- Cutset case fbe74aa76740cd72a09bc797; revision 0a2d9bc865ccbf226e0ec672
-- Compatibility view for urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)
SELECT
  source.* ,
  source."email_address" AS "email"
FROM {{ ref('customers') }} AS source
