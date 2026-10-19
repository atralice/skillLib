# Changelog

## [1.11.3](https://github.com/atralice/skillLib/compare/v1.11.2...v1.11.3) (2026-10-19)


### Bug Fixes

* app review round: cursor follows its row, broken-link rows, narrow layout ([#74](https://github.com/atralice/skillLib/issues/74)) ([e3cfb8d](https://github.com/atralice/skillLib/commit/e3cfb8d7c33a74a586716e702935f02190df1a9d))
* doctor reports broken links inside repos ([#70](https://github.com/atralice/skillLib/issues/70)) ([6d3c4c7](https://github.com/atralice/skillLib/commit/6d3c4c7fb84f011ae67f13132e997039b2fdd83c))
* round 2 of the review: no lost copies, and commands that say what they did ([#68](https://github.com/atralice/skillLib/issues/68)) ([911c805](https://github.com/atralice/skillLib/commit/911c805cdba5fb62d299331a02eeea10dc5bdbbc))
* round 3 of the review ([#71](https://github.com/atralice/skillLib/issues/71)) ([8a14420](https://github.com/atralice/skillLib/commit/8a144209065226f94fb3ae5f6a3da1d955ef1797))
* round 4 of the review ([#72](https://github.com/atralice/skillLib/issues/72)) ([08ee234](https://github.com/atralice/skillLib/commit/08ee234972304ed306bbab31eca405ee49b03d01))
* round 5 of the review (other agent combinations) ([#73](https://github.com/atralice/skillLib/issues/73)) ([f16cb8d](https://github.com/atralice/skillLib/commit/f16cb8dd460278da9d040512b31a9370ab2b0981))
* round 6: a broken repo can't break list/show; plugin removal keeps your copy ([#75](https://github.com/atralice/skillLib/issues/75)) ([e4c677b](https://github.com/atralice/skillLib/commit/e4c677bd977810d3774cf63fea87271a2bdc7e90))
* round 7: /tmp imports record no origin; Your skills lines up at 80 columns ([#76](https://github.com/atralice/skillLib/issues/76)) ([e5ea84e](https://github.com/atralice/skillLib/commit/e5ea84ebb785d04757d7f053e496840fa1e94c1f))
* the app shows doctor's issues; its own issue engine goes ([#67](https://github.com/atralice/skillLib/issues/67)) ([81b5f80](https://github.com/atralice/skillLib/commit/81b5f809b0774604a7ca7a84f6865668d23a5fa7))

## [1.11.2](https://github.com/atralice/skillLib/compare/v1.11.1...v1.11.2) (2026-10-18)


### Bug Fixes

* bugs from the repo review, and --json errors agents can read ([#64](https://github.com/atralice/skillLib/issues/64)) ([c0ee2ab](https://github.com/atralice/skillLib/commit/c0ee2ab11dc8c5a5c66e658c5c6705125eb39e22))

## [1.11.1](https://github.com/atralice/skillLib/compare/v1.11.0...v1.11.1) (2026-10-18)


### Miscellaneous Chores

* release 1.11.1 to publish the new README on npm ([7e297b1](https://github.com/atralice/skillLib/commit/7e297b1be3d12bb1503f4236375df021e623c6d3))

## [1.11.0](https://github.com/atralice/skillLib/compare/v1.10.0...v1.11.0) (2026-10-17)


### Features

* add several library skills at once, a plugin's set in one go ([3948093](https://github.com/atralice/skillLib/commit/394809316ad28a37e1971fdad2ffb672ba7dafe6))
* agents can apply doctor's choices and move global skills into repos ([f54d508](https://github.com/atralice/skillLib/commit/f54d50889157d497c2ec896ab32e96eeef797fcb))
* status --json gives each issue an id that skilllib apply takes ([37c6b22](https://github.com/atralice/skillLib/commit/37c6b2292838db3d8c9e4a4098598ee1ef89ba38))


### Bug Fixes

* don't treat agent worktrees under .claude/worktrees as projects ([b47744e](https://github.com/atralice/skillLib/commit/b47744e14f28317bd615093d2be96f28b530afea))
* review findings for apply and global move ([8df21df](https://github.com/atralice/skillLib/commit/8df21df360a3b5e63b221e846b24944bdb5aade3))
