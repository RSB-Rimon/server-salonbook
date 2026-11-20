# SalonBook MongoDB Data Model

Database name: salonbookDB

The assignment requires four main data collections. Better Auth owns its authentication collections; the application must not create a second user collection.

## 1. Users (user, managed by Better Auth)

| Field | Type | Rule |
|---|---|---|
| _id | ObjectId | Created by Better Auth |
| name | string | Required |
| email | string | Required and unique |
| image | string or null | Optional profile image URL |
| role | string | customer by default; customer or admin |
| isBlocked | boolean | false by default |
| createdAt | Date | Created by Better Auth |
| updatedAt | Date | Managed by Better Auth |

Public sign-up and profile updates must not accept role or isBlocked. Admin access is assigned through a controlled server-side process.

## 2. Services (services)

| Field | Type | Rule |
|---|---|---|
| _id | ObjectId | Primary identifier |
| serviceName | string | Required |
| category | string | Required |
| description | string | Required |
| price | number | Must be positive |
| duration | number | Positive number of minutes |
| image | string | ImgBB image URL |
| status | string | active or inactive; defaults to active |
| createdAt | Date | Creation time |

Only active services are shown publicly and can be booked.

## 3. Appointments (appointments)

| Field | Type | Rule |
|---|---|---|
| _id | ObjectId | Primary identifier |
| serviceId | ObjectId | References services._id |
| customerId | ObjectId | References Better Auth user._id |
| appointmentDate | string | Local date in YYYY-MM-DD format |
| timeSlot | string | One of the predefined time slots |
| message | string or null | Optional customer message |
| servicePrice | number | Price snapshot when the appointment is requested |
| status | string | pending, confirmed, or cancelled; defaults to pending |
| paymentStatus | string | unpaid or paid; defaults to unpaid |
| createdAt | Date | Request time |

The API will reject inactive services and conflicting active time slots. Customers can cancel only their own pending appointments.

## 4. Transactions (transactions)

| Field | Type | Rule |
|---|---|---|
| _id | ObjectId | Primary identifier |
| appointmentId | ObjectId | References appointments._id |
| customerId | ObjectId | References Better Auth user._id |
| amount | number | Amount charged |
| currency | string | Stripe currency code |
| stripeSessionId | string | Stripe Checkout Session reference |
| status | string | paid or failed |
| createdAt | Date | Transaction time |

A transaction is linked to the appointment and customer. The verified Stripe webhook is the only process that may change an appointment to paid.

## References

- appointments.serviceId → services._id
- appointments.customerId → Better Auth user._id
- transactions.appointmentId → appointments._id
- transactions.customerId → Better Auth user._id

The servicePrice field records the price at request time; the service details are read through serviceId.