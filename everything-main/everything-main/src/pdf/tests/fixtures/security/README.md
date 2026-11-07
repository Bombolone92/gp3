# Encrypted fixtures

Two-page PDFs (title `Secret Title`, author `Ada`, a text field `name` holding `Grace`) written
with pdf-lib and then encrypted by qpdf through pikepdf, an implementation independent of
`src/core/security.js`. The user password is `user` and the owner password `owner`, except:

- `owner-only.pdf`: empty user password, owner password `owner`, printing and copying denied.
- `unicode-password.pdf` and `rc4-latin1-password.pdf`: user password `pässwörd`.
- `r6-fullwidth-password.pdf` and `r6-decomposed-password.pdf`: user password `ａbc` (a fullwidth
  a) and `éclair` with a combining acute, hashed by qpdf as typed rather than in the normalized
  form the specification asks for; owner password `owner`.
- `rc4-40-r3.pdf`: written by Ghostscript (`-dEncryptionR=3 -dKeyLength=40`), user password
  `abc`, owner password `own`; revision 3 with a 40-bit key, whose owner password check hashes
  only the first five bytes of each digest.

Files are named after their algorithm: `rc4-40` (revision 2), `rc4-128` (revision 3),
`aes-128` (revision 4, once with `EncryptMetadata false`), `aes-256-r5` (the deprecated revision
5), and `aes-256` (revision 6), plus variants stored in object streams and a linearized file.

```python
import pikepdf
from pikepdf import Encryption, ObjectStreamMode
pdf = pikepdf.open('base.pdf')
pdf.save('aes-256-objstm.pdf', encryption=Encryption(user='user', owner='owner', R=6),
         object_stream_mode=ObjectStreamMode.generate)
```
