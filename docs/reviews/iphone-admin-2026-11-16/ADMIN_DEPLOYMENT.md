# Admin ব্যবহার ও deployment

16 November 2026. Admin app: `apps/admin`। এই কাজের মধ্যে Vercel deployment করা হয়নি।

## এই কম্পিউটারে ব্যবহার

(সংশোধিত, 16 November 2026 সন্ধ্যা। আগের সংস্করণ একটি অস্থায়ী synthetic preview-এর
কথা বলত, যার password প্রতিবার random — ওটা দিয়ে login করা যেত না।)

1. `apps/admin/.env.local`-এ server variables থাকতে হবে (নিচের table)। এই ফাইল
   gitignored; কখনো commit করবেন না।
2. `apps/admin` থেকে `next build`, তারপর `next start -p 3000 -H 127.0.0.1`। Browser-এ
   `http://127.0.0.1:3000` খুলুন। `-H 127.0.0.1` মানে শুধু এই কম্পিউটার থেকেই খোলা যাবে।
3. **Password বদলালে server restart করুন।** চালু server পুরোনো hash মনে রাখে, তাই
   restart ছাড়া নতুন password-এ login হবে না — দেখতে সাধারণ "invalid" error-এর মতোই।
4. ভুল password কয়েকবার দিলে ওই username কিছুক্ষণ বন্ধ থাকে (১০ বারে ১৫ মিনিট), আর
   সেই সময়ে সঠিক password-ও refuse হয়। অপেক্ষা করুন বা server restart করুন।
5. Windows-এ build বড় হাতের drive path (`D:\…`) থেকে চালান। ছোট হাতের `d:` থেকে
   চালালে Next দুবার bundle হয় এবং পাতায় সাদা "Application error" আসে।

উপরের **System / Day / Night** দিয়ে theme বদলান। System ডিভাইসের appearance অনুসরণ
করে। পছন্দ এই browser-এ থাকে; account বা database-এ জমা হয় না।

## সহজ hosted setup: GitHub → Vercel → Supabase

> **খরচের সিদ্ধান্ত আগে।** Vercel-এর free **Hobby** plan শুধু ব্যক্তিগত, অ-বাণিজ্যিক
> ব্যবহারের জন্য ([Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines))।
> Muthoy একটি বাণিজ্যিক পণ্য, তাই এর admin Hobby-তে চালানো Vercel-এর শর্ত ভাঙতে
> পারে। Pro plan (paid) নাকি অন্য host — এটি founder-এর সিদ্ধান্ত; ততদিন admin এই
> কম্পিউটারে (উপরের নিয়মে) চালানো যায়।

1. সর্বশেষ Admin theme পরিবর্তনসহ commit GitHub-এ থাকতে হবে। আগে সেই exact commit-এর
   clean install, lint, typecheck ও production build চালান। এই review-এর build existing
   installed dependencies ও offline font substitute দিয়ে হয়েছে; fresh CI install-এর প্রমাণ নয়।
2. Vercel Dashboard → **Create New → Project → Import Git Repository** থেকে
   `iimrul/muthoy` বাছুন। Admin-এর জন্য আলাদা project নিন।
   [Vercel monorepo নির্দেশনা](https://vercel.com/docs/monorepos)
3. নিচের settings দিন। Shared `packages/*` build-এর দরকার, তাই root-এর বাইরের files
   include করার setting চালু রাখুন। Next.js preset থেকেই build ও output defaults আসে।
   [Build configuration](https://vercel.com/docs/builds/configure-a-build)

   | Setting | Value |
   | --- | --- |
   | Framework | Next.js |
   | Root Directory | `apps/admin` |
   | Include files outside root | Enabled |
   | Build Command | `pnpm run build` |
   | Output Directory | Next.js default |
   | Install | Workspace/lockfile থেকে auto-detected pnpm; repo-এর `packageManager` version মেলান |

   Vercel-এর Corepack flow ব্যবহার করলে `ENABLE_EXPERIMENTAL_COREPACK=1` এবং repository
   root-এর `packageManager` pin অনুসরণ করুন। ভুল pnpm version দিয়ে lockfile regenerate
   করবেন না। [Package manager pinning](https://vercel.com/docs/builds/configure-a-build#corepack)
4. **Environment Variables**-এ নিচের server variables দিন। Preview-তে DEV backend,
   Production-এ অনুমোদিত production backend ও আলাদা credentials ব্যবহার করুন। Sensitive
   values Secret হিসেবে রাখুন; `NEXT_PUBLIC_` prefix দেবেন না। Env পরিবর্তনের পরে নতুন
   deployment প্রয়োজন। [Vercel environment variables](https://vercel.com/docs/environment-variables)

   | Variable | কী দিতে হবে |
   | --- | --- |
   | `SUPABASE_URL` | নির্বাচিত Supabase project's HTTPS URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | সেই project's server-only privileged API key |
   | `ADMIN_SESSION_SECRET` | অন্তত 32-byte cryptographically random secret |
   | `ADMIN_ACCOUNTS` | নিচের existing helper-এর তৈরি credential array |
   | `ADMIN_ROLES` | একই username-এর role map, যেমন `{"founder":"super_admin"}` |
   | `ADMIN_ORIGIN` | Optional: স্থায়ী production origin; দিলে exact HTTPS origin হতে হবে |

   Repo root-এর existing helper password echo না করে stdin থেকে পড়ে:

   ```powershell
   node scripts/admin-hash-password.mjs founder
   ```

   এর hash/salt-সহ output নির্দেশনা অনুযায়ী `ADMIN_ACCOUNTS` ও `ADMIN_ROLES` বসান।
   Password কোনো command argument, chat, commit বা browser bundle-এ দেবেন না।
   Session secret নিজের password manager-এ তৈরি/রাখুন। Map provider variables এখন optional।
5. আগে **Preview** deploy করুন। সেখানে login/logout, তিন theme, role অনুযায়ী access,
   pharmacy/account drill-down, isolated support case/note, flags, audit ও CSV/PDF পরীক্ষা
   করুন। Server key যেন Network responses বা `_next/static` bundle-এ না থাকে যাচাই করুন।
   তারপর পরীক্ষিত commit Production-এ promote/deploy করুন। পাওয়া HTTPS URL bookmark
   করেই ব্যবহার করা যাবে; স্থানীয় terminal বা computer চালু রাখার দরকার হবে না।

## Database-এর বর্তমান অবস্থা

এই review-এর **09:21 UTC** read-only DEV catalog check-এ **40 migrations**, ছয়টি
Admin/publication table, প্রত্যেকটির RLS ও service-role SELECT, `audit_logs` SELECT এবং
দুই প্রয়োজনীয় RPC পাওয়া গেছে। [Metadata receipt](evidence/appearance-dev-catalog.json)

আগের report-এর missing-table blocker এই DEV project-এ আর বর্তমান নয়। পুরোনো held
`20261116002928_admin_dev_compatibility.sql` candidate চালাবেন না; DEV এগিয়ে গেছে।
Production project একই schema-তে আছে—এমন পরীক্ষা এই turn-এ হয়নি। Production-এ
migration দরকার হলে current catalog, backup/restore ও অনুমোদিত rollout plan অনুযায়ী করুন।
এই guide কোনো hosted schema/data পরিবর্তনের নির্দেশ বা execution নয়।

Catalog মিলে যাওয়া deployed login, real writes বা real data totals মেলার প্রমাণ নয়।
সেগুলো deployment-এর পরে আলাদা acceptance করতে হবে। Maps-এর provider/consent,
notification dispatcher, subscription lifecycle override ও unavailable financial history
আগের documented সীমা রাখে। Theme এই capabilities তৈরি করে না।
