# 🚀 Getting started with Strapi

Strapi comes with a full featured [Command Line Interface](https://docs.strapi.io/dev-docs/cli) (CLI) which lets you scaffold and manage your project in seconds.

### `develop`

Start your Strapi application with autoReload enabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-develop)

```
npm run develop
# or
yarn develop
```

### `start`

Start your Strapi application with autoReload disabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-start)

```
npm run start
# or
yarn start
```

### `build`

Build your admin panel. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-build)

```
npm run build
# or
yarn build
```

## ⚙️ Deployment

Strapi gives you many possible deployment options for your project including [Strapi Cloud](https://cloud.strapi.io). Browse the [deployment section of the documentation](https://docs.strapi.io/dev-docs/deployment) to find the best solution for your use case.

```
yarn strapi deploy
```

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://strapi.io/blog) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

## 🔌 ByeMoney ↔ TarhElahi Service-to-Service Integration

This backend provides dedicated, versioned integration read endpoints for the ByeMoney ecosystem under `/api/integrations/byemoney/v1/`.

These endpoints are server-to-server endpoints protected exclusively by a static API key policy (`global::is-service-authenticated`) and **do not** require end-user Bearer JWT authentication (`auth: false`).

---

### Clean Ownership Boundaries

- **TarhElahi (Strapi)** is authoritative for:
  - User external identity (`documentId`)
  - Course catalog metadata
  - Rial price (`priceRial`)
  - Publication (`published`) & availability (`available`)
  - Educational entitlement
- **ByeMoney** is authoritative for:
  - Noor balance, wallet, and ledger
  - Rial → Noor conversion calculation
  - Purchases, deals, and financial snapshots

---

### Authentication

Requests must include the `X-Service-Key` HTTP header:

```http
X-Service-Key: <BYEMONEY_SERVICE_KEY>
```

- **Environment Variable**: `BYEMONEY_SERVICE_KEY`
- **Validation**: SHA256 hashing applied to both keys prior to `crypto.timingSafeEqual`, guaranteeing constant-time comparison that eliminates both content and length timing attack side-channels.
- **Failure Status**: Missing, empty, or mismatched keys immediately return `401 Unauthorized`.
- **Privacy & Security**: The secret key value and request header are never logged or echoed in error payloads.

#### Generating a Secure Service Key
Generate a cryptographically secure 32-byte (256-bit) random hex key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

### Endpoints

#### 1. Get User by External User ID
- **Method & Path**: `GET /api/integrations/byemoney/v1/users/:externalUserId`
- **Identifier**: `:externalUserId` resolves exclusively by the permanent Strapi 5 **`documentId`**.
  - `ExternalUserId = identity` (permanent foreign key stored in ByeMoney).
  - `Phone = attribute` (mutable profile attribute, not used as foreign key).
  - **Strictness**: Numeric database IDs are NOT accepted or resolved as the integration identity (returns 404).
- **Status Codes**:
  - `200 OK`: User found.
  - `401 Unauthorized`: Missing or invalid `X-Service-Key`.
  - `404 Not Found`: User does not exist.
- **Response DTO (Whitelist-Only)**:
```json
{
  "externalUserId": "usr_doc_987654321",
  "phoneNumber": "09121234567",
  "email": "user@example.com",
  "firstName": "Mohammad",
  "lastName": "Ahmadi",
  "confirmed": true,
  "blocked": false,
  "isMobileVerified": true,
  "createdAt": "2026-01-01T10:00:00.000Z",
  "updatedAt": "2026-01-02T10:00:00.000Z"
}
```
*Note: Sensitive security fields (`password`, `resetPasswordToken`, `confirmationToken`, `otpCode`, `otpExpiresAt`, `cartData`) are strictly excluded.*

#### 2. Get Course Catalog Item by External ID
- **Method & Path**: `GET /api/integrations/byemoney/v1/courses/:externalId`
- **Identifier**: `:externalId` resolves exclusively by the permanent Strapi 5 **`documentId`**.
  - **Strictness**: Numeric database IDs, slugs, and titles are NOT accepted as external integration identities (returns 404).
- **Status Codes**:
  - `200 OK`: Course found.
  - `401 Unauthorized`: Missing or invalid `X-Service-Key`.
  - `404 Not Found`: Course does not exist.
- **Authoritative Catalog Response DTO**:
```json
{
  "source": "tarh_elahi",
  "type": "course",
  "externalId": "crs_doc_123456789",
  "parentExternalId": null,
  "title": "Mastering Digital Marketing",
  "slug": "mastering-digital-marketing",
  "priceRial": 2500000,
  "published": true,
  "available": true,
  "updatedAt": "2026-01-02T10:00:00.000Z"
}
```
*Notes on Catalog Semantics:*
- `priceRial`: Authoritative Rial price from TarhElahi Strapi. ByeMoney calculates Rial → Noor.
- `published`: `true` if course has been published (`publishedAt != null`).
- `available`: Truthfully mirrors publication status (`publishedAt != null`). The current Strapi Course model contains no separate purchasability flag (`isPurchasable`, `salesEnabled`); publication status is the authoritative indicator of catalog availability without inventing artificial semantics.

---

### Secret Management & Key Rotation

1. **Local Development**:
   - Copy `.env.example` to `.env` if not already present.
   - Generate a 32-byte key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   - Set `BYEMONEY_SERVICE_KEY` in `.env` (gitignored).
   - Restart the local server (`npm run dev`).

2. **Production Manual Key Rotation (Liara)**:
   - **Never commit production keys to git.**
   - In single-secret configurations, rotation is performed by updating the environment variable and restarting the application (clients must coordinate switching to the new key):
   - **Via Liara Console**: Go to app dashboard (`tarhelahi-strapi`) > **تنظیمات برنامه** > **متغیرها (Environment Variables)**. Update `BYEMONEY_SERVICE_KEY` with the new generated secret and click **ثبت تغییرات**.
   - **Via Liara CLI**:
     ```bash
     liara env:set BYEMONEY_SERVICE_KEY="<new_32_byte_secret>" --app tarhelahi-strapi
     ```
   - Liara automatically restarts the container with the updated secret without needing a code rebuild.

---

<sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>
