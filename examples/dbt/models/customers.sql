select
  customer_id,
  email as email_address
from {{ ref('stg_customers') }}

