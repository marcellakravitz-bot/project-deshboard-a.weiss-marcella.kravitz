# By Room — מודול נפרד באתר A. Weiss

byroom build 1 · 24.10.2026

כל הקוד של By Room נמצא בתיקייה הזו. הדשבורד (`index.html` בשורש) רק טוען את המודול ומפנה אליו מהקובייה.
כל הנתונים נשמרים ב-Supabase, בטבלאות שמתחילות ב-`byroom_`. המודול לא כותב ל-`app_state`.

## מה יש בתיקייה

| קובץ / תיקייה | מה זה | לאן עולה |
| --- | --- | --- |
| `admin.js` | מסך המנהל: גרסאות, העלאה, עיבוד, בדיקה ואישור V, חדרים, קבצי עבודה, QR, היסטוריה | GitHub, `byroom/` |
| `view.js` | מציג החדרים, עותק אחד: לטלפון (QR) ולמשתמש מחובר בדשבורד | GitHub, `byroom/` |
| `index.html` | הדף שנפתח מקוד QR. צפייה בלבד, בלי התחברות | GitHub, `byroom/` |
| `config.js` | כתובת פונקציות השרת (אותו פרויקט Supabase כמו ב-`sign.js`) | GitHub, `byroom/` |
| `supabase/001_byroom.sql` | 12 הטבלאות, ההרשאות (RLS) ופונקציית האישור | Supabase › SQL (פעם אחת) |
| `supabase/functions/byroom-admin` | צד השרת של המנהל: העלאה ל-Google Cloud, הפעלת עיבוד, ניקוי, קישור PDF | Supabase › Edge Functions |
| `supabase/functions/byroom-public` | מה ש-QR קורא: חדר מאושר אחד, מפת הקומה | Supabase › Edge Functions (בלי אימות JWT) |
| `supabase/functions/_shared/gcp.ts` | גישה ל-Google Cloud משותפת לשתי הפונקציות | עם הפונקציות |
| `worker/` | קוד העיבוד (Python): DXF, PDF, RVT, הצלבה, מפת קומה | Google Cloud Run, דרך GitHub Actions |
| `cloud/setup.sh` | הקמה חד-פעמית של Google Cloud (ב-Cloud Shell) | לא עולה לשום מקום — מריצים פעם אחת |

מחוץ לתיקייה:
- `.github/workflows/byroom-worker.yml` — מפרסם את העובד ל-Google Cloud כשמשהו ב-`byroom/worker` משתנה.
- `index.html` (build 220, על בסיס build 219) — שלושה שינויים בלבד: מספר build, הקובייה טוענת את `byroom/admin.js`, ובלוק התוכניות הישן בהגדרות הפרויקט מוסתר (הקוד שלו נשאר).

## הדרך של קובץ

1. מנהל: גרסה חדשה ← גרירת הקבצים ← אישור הזיהוי ← העלאה.
2. הדפדפן מעלה ישירות ל-Google Cloud Storage, בחלקים של 16MB, עם המשכה אחרי ניתוק. DXF נדחס בדפדפן תוך כדי.
3. `byroom-admin` מפעיל את העובד ב-Cloud Run, קובץ אחד בכל הפעלה.
4. העובד בודק טביעת אצבע (SHA-256), קורא את הקובץ ושומר נתונים מחולצים קטנים. PDF מועתק לארכיון.
5. כשכל קבצי הגרסה מוכנים, העובד מצליב ביניהם וכותב שורות בדיקה (`byroom_room_review`) ומפת קומה.
6. מנהל מסמן V ולוחץ "אישור שינויים מסומנים". רק `byroom_approve_items()` כותבת לנתונים הפעילים.

## הקמה (פעם אחת)

1. **Google Cloud:** פותחים פרויקט על שם החברה, ב-Cloud Shell מריצים `bash setup.sh <PROJECT_ID>`. בסוף מודפסות ההוראות: אילו ערכים להכניס ל-GitHub ואילו ל-Supabase.
2. **Supabase:** מריצים את `supabase/001_byroom.sql`, מעלים את שתי הפונקציות, ומכניסים את הסודות שהסקריפט הדפיס. את `byroom-public` מפרסמים בלי אימות JWT.
3. **GitHub:** מעלים את `byroom/`, את `.github/workflows/byroom-worker.yml` ואת `index.html`. העלאת התיקייה `byroom/worker` מפעילה את פרסום העובד.

## בדיקות

- `worker/tests/test_floor4.py` — בדיקת רגרסיה על קבצי קומה 4 האמיתיים (מריצים מקומית; הקבצים לא במאגר).
- נבדק מקומית ב-24.10.2026:
  - הקריאה וההצלבה על כל 7 קבצי קומה 4.
  - הטבלאות ופונקציית האישור על Postgres 16, כולל הרשאות.
  - קוד הקישור החתום, מול הספרייה של Google.
  - המסכים, בדפדפן.
