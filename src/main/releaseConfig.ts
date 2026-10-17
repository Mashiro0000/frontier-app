// Where updates come from and the key they must be signed with (Stage 18, D-050). Both are set by the owner, never by the app:
//  - RELEASE_PUBLIC_KEY: the public half of the owner's Ed25519 release key, as base64 of its 32 raw bytes. `node tools/release.mjs keygen` makes the
//    key pair on the owner's PC, keeps the private half outside the repo, and writes the public half here. While it is empty this build accepts no
//    update at all, and Settings says so.
//  - RELEASES_REPO: the public, releases-only GitHub repository ("owner/name") the update check reads from. The code repository is private, so an
//    installed app could not read its releases without a token, and a token in the app is out of the question.
export const RELEASE_PUBLIC_KEY = ''
export const RELEASES_REPO = 'Mashiro0000/frontier-app-releases'
