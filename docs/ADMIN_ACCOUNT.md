# Set up the first admin account

Every account created through the public sign-up page receives the customer role. Do not add an admin role choice to public sign-up.

To give admin access to an existing account:

1. Sign up through SalonBook with the email you want to use as the admin.
2. In salon-Bok-server/.env, set ADMIN_EMAIL to that same email. Keep the file private.
3. From the salon-Bok-server folder, run:

        npm run promote-admin

4. Sign out of SalonBook and sign in again. Open /dashboard/admin.

The command updates only the matching account in the salonbookDB.user collection. It uses MONGODB_URI from the server .env; never put the database URI or password in chat or GitHub.