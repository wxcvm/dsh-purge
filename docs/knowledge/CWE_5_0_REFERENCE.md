# CWE 5.0 官方分类参考索引

面向软件设计、代码审查、缺陷分类和修复验收的独立人工参考。数据取自 CWE 5.0（2026-10-28）的社区转换快照 [hahwul/cwe.cr](https://github.com/hahwul/cwe.cr)，源文件 `src/cwe/data/weaknesses.json` 的 Git blob SHA 为 `063d3bc01b2a1583a0e89e99e70b699b486ce520`。官方数据与发布说明见 [CWE List](https://cwe.mitre.org/data/) 与 [Downloads](https://cwe.mitre.org/data/downloads)。转换快照并非 MITRE 官方原始下载文件；需要以对应官方条目核对最新状态。

- 共 **1477** 个不重复的 CWE ID：984 条弱点（956 条未标为 Deprecated/Obsolete）、431 个分组、62 个视图。分组和视图不是漏洞；弱点分类也不是 CVE 或已确认的漏洞。692 条弱点的来源含潜在缓解措施，索引仅保留其修复阶段和官方链接。
- 保留英文原始名称和状态以便准确引用，Draft/Incomplete 不代表已充分复核；Deprecated/Obsolete 仅供历史映射。空白阶段不是无修复措施。
- 不包含目标匹配规则、利用步骤、攻击样例、自动扫描或调度逻辑。文档独立于运行时知识匹配，不增加启动负担。
- 对于具体 CVE，另外核对实际软件包、厂商安全公告、修复版本和回归证据；不要从 CWE 名称推断资产受影响。

## 来源与许可

Copyright © 2006–2026 The MITRE Corporation. CWE™ is a trademark of The MITRE Corporation.

CWE Usage: The MITRE Corporation hereby grants you a non-exclusive, royalty-free license to use CWE for research, development, and commercial purposes. Any copy you make for such purposes is authorized on the condition that you reproduce MITRE’s copyright designation and this license in any such copy. See the [CWE Terms of Use](https://cwe.mitre.org/about/termsofuse.html) for the full terms and disclaimers. The reference is provided as-is, without warranties. The source transformation repository is [MIT licensed](https://github.com/hahwul/cwe.cr/blob/main/LICENSE); no transformation code is copied here. Original CWE names and status remain attributed to MITRE.

## 弱点（984）

| 官方 ID | 名称 | 状态 | 抽象层级 / 类型 | 修复阶段（公告提供时） |
| --- | --- | --- | --- | --- |
| [CWE-5](https://cwe.mitre.org/data/definitions/5.html) | J2EE Misconfiguration: Data Transmission Without Encryption | Draft | Variant | System Configuration |
| [CWE-6](https://cwe.mitre.org/data/definitions/6.html) | J2EE Misconfiguration: Insufficient Session-ID Length | Incomplete | Variant | Implementation |
| [CWE-7](https://cwe.mitre.org/data/definitions/7.html) | J2EE Misconfiguration: Missing Custom Error Page | Incomplete | Variant | Implementation; System Configuration |
| [CWE-8](https://cwe.mitre.org/data/definitions/8.html) | J2EE Misconfiguration: Entity Bean Declared Remote | Incomplete | Variant | Implementation |
| [CWE-9](https://cwe.mitre.org/data/definitions/9.html) | J2EE Misconfiguration: Weak Access Permissions for EJB Methods | Draft | Variant | Architecture and Design; System Configuration |
| [CWE-11](https://cwe.mitre.org/data/definitions/11.html) | ASP.NET Misconfiguration: Creating Debug Binary | Draft | Variant | System Configuration |
| [CWE-12](https://cwe.mitre.org/data/definitions/12.html) | ASP.NET Misconfiguration: Missing Custom Error Page | Draft | Variant | Architecture and Design; Implementation; System Configuration |
| [CWE-13](https://cwe.mitre.org/data/definitions/13.html) | ASP.NET Misconfiguration: Password in Configuration File | Draft | Variant | Implementation |
| [CWE-14](https://cwe.mitre.org/data/definitions/14.html) | Compiler Removal of Code to Clear Buffers | Draft | Variant | Architecture and Design; Build and Compilation; Implementation |
| [CWE-15](https://cwe.mitre.org/data/definitions/15.html) | External Control of System or Configuration Setting | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-20](https://cwe.mitre.org/data/definitions/20.html) | Improper Input Validation | Stable | Class | Architecture and Design; Implementation |
| [CWE-22](https://cwe.mitre.org/data/definitions/22.html) | Improper Limitation of a Pathname to a Restricted Directory | Stable | Base | Architecture and Design; Implementation; Operation |
| [CWE-23](https://cwe.mitre.org/data/definitions/23.html) | Relative Path Traversal | Draft | Base | Implementation; Operation |
| [CWE-24](https://cwe.mitre.org/data/definitions/24.html) | Path Traversal: '../filedir' | Incomplete | Variant | Implementation |
| [CWE-25](https://cwe.mitre.org/data/definitions/25.html) | Path Traversal: '/../filedir' | Incomplete | Variant | Implementation |
| [CWE-26](https://cwe.mitre.org/data/definitions/26.html) | Path Traversal: '/dir/../filename' | Draft | Variant | Implementation |
| [CWE-27](https://cwe.mitre.org/data/definitions/27.html) | Path Traversal: 'dir/../../filename' | Draft | Variant | Implementation |
| [CWE-28](https://cwe.mitre.org/data/definitions/28.html) | Path Traversal: '..\filedir' | Incomplete | Variant | Implementation |
| [CWE-29](https://cwe.mitre.org/data/definitions/29.html) | Path Traversal: '\..\filename' | Incomplete | Variant | Implementation |
| [CWE-30](https://cwe.mitre.org/data/definitions/30.html) | Path Traversal: '\dir\..\filename' | Draft | Variant | Implementation |
| [CWE-31](https://cwe.mitre.org/data/definitions/31.html) | Path Traversal: 'dir\..\..\filename' | Draft | Variant | Implementation |
| [CWE-32](https://cwe.mitre.org/data/definitions/32.html) | Path Traversal: '...' (Triple Dot) | Incomplete | Variant | Implementation |
| [CWE-33](https://cwe.mitre.org/data/definitions/33.html) | Path Traversal: '....' (Multiple Dot) | Incomplete | Variant | Implementation |
| [CWE-34](https://cwe.mitre.org/data/definitions/34.html) | Path Traversal: '....//' | Incomplete | Variant | Implementation |
| [CWE-35](https://cwe.mitre.org/data/definitions/35.html) | Path Traversal: '.../...//' | Incomplete | Variant | Implementation |
| [CWE-36](https://cwe.mitre.org/data/definitions/36.html) | Absolute Path Traversal | Draft | Base | Implementation; Operation |
| [CWE-37](https://cwe.mitre.org/data/definitions/37.html) | Path Traversal: '/absolute/pathname/here' | Draft | Variant | Implementation |
| [CWE-38](https://cwe.mitre.org/data/definitions/38.html) | Path Traversal: '\absolute\pathname\here' | Draft | Variant | Implementation |
| [CWE-39](https://cwe.mitre.org/data/definitions/39.html) | Path Traversal: 'C:dirname' | Draft | Variant | Implementation |
| [CWE-40](https://cwe.mitre.org/data/definitions/40.html) | Path Traversal: '\\UNC\share\name\' (Windows UNC Share) | Draft | Variant | Implementation |
| [CWE-41](https://cwe.mitre.org/data/definitions/41.html) | Improper Resolution of Path Equivalence | Incomplete | Base | Implementation |
| [CWE-42](https://cwe.mitre.org/data/definitions/42.html) | Path Equivalence: 'filename.' (Trailing Dot) | Incomplete | Variant | — |
| [CWE-43](https://cwe.mitre.org/data/definitions/43.html) | Path Equivalence: 'filename....' (Multiple Trailing Dot) | Incomplete | Variant | — |
| [CWE-44](https://cwe.mitre.org/data/definitions/44.html) | Path Equivalence: 'file.name' (Internal Dot) | Incomplete | Variant | — |
| [CWE-45](https://cwe.mitre.org/data/definitions/45.html) | Path Equivalence: 'file...name' (Multiple Internal Dot) | Incomplete | Variant | — |
| [CWE-46](https://cwe.mitre.org/data/definitions/46.html) | Path Equivalence: 'filename ' (Trailing Space) | Incomplete | Variant | — |
| [CWE-47](https://cwe.mitre.org/data/definitions/47.html) | Path Equivalence: ' filename' (Leading Space) | Incomplete | Variant | — |
| [CWE-48](https://cwe.mitre.org/data/definitions/48.html) | Path Equivalence: 'file name' (Internal Whitespace) | Incomplete | Variant | — |
| [CWE-49](https://cwe.mitre.org/data/definitions/49.html) | Path Equivalence: 'filename/' (Trailing Slash) | Incomplete | Variant | — |
| [CWE-50](https://cwe.mitre.org/data/definitions/50.html) | Path Equivalence: '//multiple/leading/slash' | Incomplete | Variant | — |
| [CWE-51](https://cwe.mitre.org/data/definitions/51.html) | Path Equivalence: '/multiple//internal/slash' | Incomplete | Variant | Implementation |
| [CWE-52](https://cwe.mitre.org/data/definitions/52.html) | Path Equivalence: '/multiple/trailing/slash//' | Incomplete | Variant | Implementation |
| [CWE-53](https://cwe.mitre.org/data/definitions/53.html) | Path Equivalence: '\multiple\\internal\backslash' | Incomplete | Variant | Implementation |
| [CWE-54](https://cwe.mitre.org/data/definitions/54.html) | Path Equivalence: 'filedir\' (Trailing Backslash) | Incomplete | Variant | Implementation |
| [CWE-55](https://cwe.mitre.org/data/definitions/55.html) | Path Equivalence: '/./' (Single Dot Directory) | Incomplete | Variant | Implementation |
| [CWE-56](https://cwe.mitre.org/data/definitions/56.html) | Path Equivalence: 'filedir*' (Wildcard) | Incomplete | Variant | Implementation |
| [CWE-57](https://cwe.mitre.org/data/definitions/57.html) | Path Equivalence: 'fakedir/../realdir/filename' | Incomplete | Variant | Implementation |
| [CWE-58](https://cwe.mitre.org/data/definitions/58.html) | Path Equivalence: Windows 8.3 Filename | Incomplete | Variant | System Configuration |
| [CWE-59](https://cwe.mitre.org/data/definitions/59.html) | Improper Link Resolution Before File Access | Draft | Base | Architecture and Design |
| [CWE-61](https://cwe.mitre.org/data/definitions/61.html) | UNIX Symbolic Link (Symlink) Following | Incomplete | Compound | Architecture and Design; Implementation |
| [CWE-62](https://cwe.mitre.org/data/definitions/62.html) | UNIX Hard Link | Incomplete | Variant | Architecture and Design |
| [CWE-64](https://cwe.mitre.org/data/definitions/64.html) | Windows Shortcut Following (.LNK) | Incomplete | Variant | Architecture and Design |
| [CWE-65](https://cwe.mitre.org/data/definitions/65.html) | Windows Hard Link | Incomplete | Variant | Architecture and Design |
| [CWE-66](https://cwe.mitre.org/data/definitions/66.html) | Improper Handling of File Names that Identify Virtual Resources | Draft | Base | — |
| [CWE-67](https://cwe.mitre.org/data/definitions/67.html) | Improper Handling of Windows Device Names | Incomplete | Variant | Implementation |
| [CWE-69](https://cwe.mitre.org/data/definitions/69.html) | Improper Handling of Windows ::DATA Alternate Data Stream | Incomplete | Variant | Implementation |
| [CWE-71](https://cwe.mitre.org/data/definitions/71.html) | DEPRECATED: Apple '.DS_Store' | Deprecated | Variant | — |
| [CWE-72](https://cwe.mitre.org/data/definitions/72.html) | Improper Handling of Apple HFS+ Alternate Data Stream Path | Incomplete | Variant | — |
| [CWE-73](https://cwe.mitre.org/data/definitions/73.html) | External Control of File Name or Path | Draft | Base | Architecture and Design; Implementation; Installation; Operation; Testing |
| [CWE-74](https://cwe.mitre.org/data/definitions/74.html) | Improper Neutralization of Special Elements in Output Used by a Downstream Component | Incomplete | Class | Implementation; Requirements |
| [CWE-75](https://cwe.mitre.org/data/definitions/75.html) | Failure to Sanitize Special Elements into a Different Plane | Draft | Class | Implementation; Requirements |
| [CWE-76](https://cwe.mitre.org/data/definitions/76.html) | Improper Neutralization of Equivalent Special Elements | Draft | Base | Implementation; Requirements |
| [CWE-77](https://cwe.mitre.org/data/definitions/77.html) | Improper Neutralization of Special Elements used in a Command | Draft | Class | Architecture and Design; Implementation; Operation; System Configuration |
| [CWE-78](https://cwe.mitre.org/data/definitions/78.html) | Improper Neutralization of Special Elements used in an OS Command | Stable | Base | Architecture and Design; Implementation; Operation |
| [CWE-79](https://cwe.mitre.org/data/definitions/79.html) | Improper Neutralization of Input During Web Page Generation | Stable | Base | Architecture and Design; Implementation; Operation |
| [CWE-80](https://cwe.mitre.org/data/definitions/80.html) | Improper Neutralization of Script-Related HTML Tags in a Web Page | Incomplete | Variant | Implementation |
| [CWE-81](https://cwe.mitre.org/data/definitions/81.html) | Improper Neutralization of Script in an Error Message Web Page | Incomplete | Variant | Implementation |
| [CWE-82](https://cwe.mitre.org/data/definitions/82.html) | Improper Neutralization of Script in Attributes of IMG Tags in a Web Page | Incomplete | Variant | Implementation |
| [CWE-83](https://cwe.mitre.org/data/definitions/83.html) | Improper Neutralization of Script in Attributes in a Web Page | Draft | Variant | Implementation |
| [CWE-84](https://cwe.mitre.org/data/definitions/84.html) | Improper Neutralization of Encoded URI Schemes in a Web Page | Draft | Variant | Implementation |
| [CWE-85](https://cwe.mitre.org/data/definitions/85.html) | Doubled Character XSS Manipulations | Draft | Variant | Implementation |
| [CWE-86](https://cwe.mitre.org/data/definitions/86.html) | Improper Neutralization of Invalid Characters in Identifiers in Web Pages | Draft | Variant | Implementation |
| [CWE-87](https://cwe.mitre.org/data/definitions/87.html) | Improper Neutralization of Alternate XSS Syntax | Draft | Variant | Implementation |
| [CWE-88](https://cwe.mitre.org/data/definitions/88.html) | Improper Neutralization of Argument Delimiters in a Command | Draft | Base | Architecture and Design; Implementation; Testing |
| [CWE-89](https://cwe.mitre.org/data/definitions/89.html) | Improper Neutralization of Special Elements used in an SQL Command | Stable | Base | Architecture and Design; Implementation; Operation |
| [CWE-90](https://cwe.mitre.org/data/definitions/90.html) | Improper Neutralization of Special Elements used in an LDAP Query | Draft | Base | Implementation |
| [CWE-91](https://cwe.mitre.org/data/definitions/91.html) | XML Injection | Draft | Base | Implementation |
| [CWE-92](https://cwe.mitre.org/data/definitions/92.html) | DEPRECATED: Improper Sanitization of Custom Special Characters | Deprecated | Base | — |
| [CWE-93](https://cwe.mitre.org/data/definitions/93.html) | Improper Neutralization of CRLF Sequences | Draft | Base | Implementation |
| [CWE-94](https://cwe.mitre.org/data/definitions/94.html) | Improper Control of Generation of Code | Draft | Base | Architecture and Design; Implementation; Operation; Testing |
| [CWE-95](https://cwe.mitre.org/data/definitions/95.html) | Improper Neutralization of Directives in Dynamically Evaluated Code | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-96](https://cwe.mitre.org/data/definitions/96.html) | Improper Neutralization of Directives in Statically Saved Code | Draft | Base | Implementation |
| [CWE-97](https://cwe.mitre.org/data/definitions/97.html) | Improper Neutralization of Server-Side Includes (SSI) Within a Web Page | Draft | Variant | — |
| [CWE-98](https://cwe.mitre.org/data/definitions/98.html) | Improper Control of Filename for Include/Require Statement in PHP Program | Draft | Variant | Architecture and Design; Implementation; Operation |
| [CWE-99](https://cwe.mitre.org/data/definitions/99.html) | Improper Control of Resource Identifiers | Draft | Class | Implementation |
| [CWE-102](https://cwe.mitre.org/data/definitions/102.html) | Struts: Duplicate Validation Forms | Incomplete | Variant | Implementation |
| [CWE-103](https://cwe.mitre.org/data/definitions/103.html) | Struts: Incomplete validate() Method Definition | Draft | Variant | Implementation |
| [CWE-104](https://cwe.mitre.org/data/definitions/104.html) | Struts: Form Bean Does Not Extend Validation Class | Draft | Variant | Implementation |
| [CWE-105](https://cwe.mitre.org/data/definitions/105.html) | Struts: Form Field Without Validator | Draft | Variant | Implementation |
| [CWE-106](https://cwe.mitre.org/data/definitions/106.html) | Struts: Plug-in Framework not in Use | Draft | Variant | Architecture and Design; Implementation |
| [CWE-107](https://cwe.mitre.org/data/definitions/107.html) | Struts: Unused Validation Form | Draft | Variant | Implementation |
| [CWE-108](https://cwe.mitre.org/data/definitions/108.html) | Struts: Unvalidated Action Form | Incomplete | Variant | Implementation |
| [CWE-109](https://cwe.mitre.org/data/definitions/109.html) | Struts: Validator Turned Off | Draft | Variant | Implementation |
| [CWE-110](https://cwe.mitre.org/data/definitions/110.html) | Struts: Validator Without Form Field | Draft | Variant | — |
| [CWE-111](https://cwe.mitre.org/data/definitions/111.html) | Direct Use of Unsafe JNI | Draft | Variant | Implementation |
| [CWE-112](https://cwe.mitre.org/data/definitions/112.html) | Missing XML Validation | Draft | Base | Architecture and Design |
| [CWE-113](https://cwe.mitre.org/data/definitions/113.html) | Improper Neutralization of CRLF Sequences in HTTP Headers | Incomplete | Variant | Implementation |
| [CWE-114](https://cwe.mitre.org/data/definitions/114.html) | Process Control | Incomplete | Class | Architecture and Design |
| [CWE-115](https://cwe.mitre.org/data/definitions/115.html) | Misinterpretation of Input | Incomplete | Base | — |
| [CWE-116](https://cwe.mitre.org/data/definitions/116.html) | Improper Encoding or Escaping of Output | Draft | Class | Architecture and Design; Implementation; Requirements |
| [CWE-117](https://cwe.mitre.org/data/definitions/117.html) | Improper Output Neutralization for Logs | Draft | Base | Implementation |
| [CWE-118](https://cwe.mitre.org/data/definitions/118.html) | Incorrect Access of Indexable Resource | Incomplete | Class | — |
| [CWE-119](https://cwe.mitre.org/data/definitions/119.html) | Improper Restriction of Operations within the Bounds of a Memory Buffer | Stable | Class | Architecture and Design; Build and Compilation; Implementation; Operation; Requirements |
| [CWE-120](https://cwe.mitre.org/data/definitions/120.html) | Buffer Copy without Checking Size of Input | Incomplete | Base | Architecture and Design; Build and Compilation; Implementation; Operation; Requirements |
| [CWE-121](https://cwe.mitre.org/data/definitions/121.html) | Stack-based Buffer Overflow | Draft | Variant | Architecture and Design; Build and Compilation; Implementation; Operation |
| [CWE-122](https://cwe.mitre.org/data/definitions/122.html) | Heap-based Buffer Overflow | Draft | Variant | Architecture and Design; Build and Compilation; Implementation; Operation |
| [CWE-123](https://cwe.mitre.org/data/definitions/123.html) | Write-what-where Condition | Draft | Base | Architecture and Design; Operation |
| [CWE-124](https://cwe.mitre.org/data/definitions/124.html) | Buffer Underwrite | Incomplete | Base | Implementation; Requirements |
| [CWE-125](https://cwe.mitre.org/data/definitions/125.html) | Out-of-bounds Read | Draft | Base | Architecture and Design; Implementation |
| [CWE-126](https://cwe.mitre.org/data/definitions/126.html) | Buffer Over-read | Draft | Variant | — |
| [CWE-127](https://cwe.mitre.org/data/definitions/127.html) | Buffer Under-read | Draft | Variant | — |
| [CWE-128](https://cwe.mitre.org/data/definitions/128.html) | Wrap-around Error | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-129](https://cwe.mitre.org/data/definitions/129.html) | Improper Validation of Array Index | Draft | Variant | Architecture and Design; Build and Compilation; Implementation; Operation; Requirements |
| [CWE-130](https://cwe.mitre.org/data/definitions/130.html) | Improper Handling of Length Parameter Inconsistency | Incomplete | Base | Implementation |
| [CWE-131](https://cwe.mitre.org/data/definitions/131.html) | Incorrect Calculation of Buffer Size | Draft | Base | Architecture and Design; Build and Compilation; Implementation; Operation |
| [CWE-132](https://cwe.mitre.org/data/definitions/132.html) | DEPRECATED: Miscalculated Null Termination | Deprecated | Base | — |
| [CWE-134](https://cwe.mitre.org/data/definitions/134.html) | Use of Externally-Controlled Format String | Draft | Base | Build and Compilation; Implementation; Requirements |
| [CWE-135](https://cwe.mitre.org/data/definitions/135.html) | Incorrect Calculation of Multi-Byte String Length | Draft | Base | Implementation |
| [CWE-138](https://cwe.mitre.org/data/definitions/138.html) | Improper Neutralization of Special Elements | Draft | Class | Implementation |
| [CWE-140](https://cwe.mitre.org/data/definitions/140.html) | Improper Neutralization of Delimiters | Draft | Base | Implementation |
| [CWE-141](https://cwe.mitre.org/data/definitions/141.html) | Improper Neutralization of Parameter/Argument Delimiters | Draft | Variant | Implementation |
| [CWE-142](https://cwe.mitre.org/data/definitions/142.html) | Improper Neutralization of Value Delimiters | Draft | Variant | Implementation |
| [CWE-143](https://cwe.mitre.org/data/definitions/143.html) | Improper Neutralization of Record Delimiters | Draft | Variant | Implementation |
| [CWE-144](https://cwe.mitre.org/data/definitions/144.html) | Improper Neutralization of Line Delimiters | Draft | Variant | Implementation |
| [CWE-145](https://cwe.mitre.org/data/definitions/145.html) | Improper Neutralization of Section Delimiters | Incomplete | Variant | Implementation |
| [CWE-146](https://cwe.mitre.org/data/definitions/146.html) | Improper Neutralization of Expression/Command Delimiters | Incomplete | Variant | Implementation |
| [CWE-147](https://cwe.mitre.org/data/definitions/147.html) | Improper Neutralization of Input Terminators | Draft | Variant | Implementation |
| [CWE-148](https://cwe.mitre.org/data/definitions/148.html) | Improper Neutralization of Input Leaders | Draft | Variant | Implementation |
| [CWE-149](https://cwe.mitre.org/data/definitions/149.html) | Improper Neutralization of Quoting Syntax | Draft | Variant | Implementation |
| [CWE-150](https://cwe.mitre.org/data/definitions/150.html) | Improper Neutralization of Escape, Meta, or Control Sequences | Incomplete | Variant | Build and Compilation; Implementation |
| [CWE-151](https://cwe.mitre.org/data/definitions/151.html) | Improper Neutralization of Comment Delimiters | Draft | Variant | Implementation |
| [CWE-152](https://cwe.mitre.org/data/definitions/152.html) | Improper Neutralization of Macro Symbols | Draft | Variant | Implementation |
| [CWE-153](https://cwe.mitre.org/data/definitions/153.html) | Improper Neutralization of Substitution Characters | Draft | Variant | Implementation |
| [CWE-154](https://cwe.mitre.org/data/definitions/154.html) | Improper Neutralization of Variable Name Delimiters | Incomplete | Variant | Implementation |
| [CWE-155](https://cwe.mitre.org/data/definitions/155.html) | Improper Neutralization of Wildcards or Matching Symbols | Draft | Variant | Implementation |
| [CWE-156](https://cwe.mitre.org/data/definitions/156.html) | Improper Neutralization of Whitespace | Draft | Variant | Implementation |
| [CWE-157](https://cwe.mitre.org/data/definitions/157.html) | Failure to Sanitize Paired Delimiters | Draft | Variant | Implementation |
| [CWE-158](https://cwe.mitre.org/data/definitions/158.html) | Improper Neutralization of Null Byte or NUL Character | Incomplete | Variant | Implementation |
| [CWE-159](https://cwe.mitre.org/data/definitions/159.html) | Improper Handling of Invalid Use of Special Elements | Draft | Class | Implementation |
| [CWE-160](https://cwe.mitre.org/data/definitions/160.html) | Improper Neutralization of Leading Special Elements | Incomplete | Variant | Implementation |
| [CWE-161](https://cwe.mitre.org/data/definitions/161.html) | Improper Neutralization of Multiple Leading Special Elements | Incomplete | Variant | Implementation |
| [CWE-162](https://cwe.mitre.org/data/definitions/162.html) | Improper Neutralization of Trailing Special Elements | Incomplete | Variant | Implementation |
| [CWE-163](https://cwe.mitre.org/data/definitions/163.html) | Improper Neutralization of Multiple Trailing Special Elements | Incomplete | Variant | Implementation |
| [CWE-164](https://cwe.mitre.org/data/definitions/164.html) | Improper Neutralization of Internal Special Elements | Incomplete | Variant | Implementation |
| [CWE-165](https://cwe.mitre.org/data/definitions/165.html) | Improper Neutralization of Multiple Internal Special Elements | Incomplete | Variant | Implementation |
| [CWE-166](https://cwe.mitre.org/data/definitions/166.html) | Improper Handling of Missing Special Element | Draft | Base | Implementation |
| [CWE-167](https://cwe.mitre.org/data/definitions/167.html) | Improper Handling of Additional Special Element | Draft | Base | Implementation |
| [CWE-168](https://cwe.mitre.org/data/definitions/168.html) | Improper Handling of Inconsistent Special Elements | Draft | Base | Implementation |
| [CWE-170](https://cwe.mitre.org/data/definitions/170.html) | Improper Null Termination | Incomplete | Base | Implementation; Requirements |
| [CWE-172](https://cwe.mitre.org/data/definitions/172.html) | Improper Encoding or Decoding of Data | Draft | Class | Implementation |
| [CWE-173](https://cwe.mitre.org/data/definitions/173.html) | Improper Handling of Alternate Encoding | Draft | Variant | Architecture and Design; Implementation |
| [CWE-174](https://cwe.mitre.org/data/definitions/174.html) | Double Decoding of the Same Data | Draft | Base | Architecture and Design; Implementation |
| [CWE-175](https://cwe.mitre.org/data/definitions/175.html) | Improper Handling of Mixed Encoding | Draft | Variant | Architecture and Design; Implementation |
| [CWE-176](https://cwe.mitre.org/data/definitions/176.html) | Improper Handling of Unicode Encoding | Draft | Variant | Architecture and Design; Implementation |
| [CWE-177](https://cwe.mitre.org/data/definitions/177.html) | Improper Handling of URL Encoding (Hex Encoding) | Draft | Variant | Architecture and Design; Implementation |
| [CWE-178](https://cwe.mitre.org/data/definitions/178.html) | Improper Handling of Case Sensitivity | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-179](https://cwe.mitre.org/data/definitions/179.html) | Incorrect Behavior Order: Early Validation | Incomplete | Base | Implementation |
| [CWE-180](https://cwe.mitre.org/data/definitions/180.html) | Incorrect Behavior Order: Validate Before Canonicalize | Draft | Variant | Implementation |
| [CWE-181](https://cwe.mitre.org/data/definitions/181.html) | Incorrect Behavior Order: Validate Before Filter | Draft | Variant | Architecture and Design; Implementation |
| [CWE-182](https://cwe.mitre.org/data/definitions/182.html) | Collapse of Data into Unsafe Value | Draft | Base | Architecture and Design; Implementation |
| [CWE-183](https://cwe.mitre.org/data/definitions/183.html) | Permissive List of Allowed Inputs | Draft | Base | — |
| [CWE-184](https://cwe.mitre.org/data/definitions/184.html) | Incomplete List of Disallowed Inputs | Draft | Base | Implementation |
| [CWE-185](https://cwe.mitre.org/data/definitions/185.html) | Incorrect Regular Expression | Draft | Base | Implementation |
| [CWE-186](https://cwe.mitre.org/data/definitions/186.html) | Overly Restrictive Regular Expression | Draft | Base | Implementation |
| [CWE-187](https://cwe.mitre.org/data/definitions/187.html) | Partial String Comparison | Incomplete | Variant | Testing |
| [CWE-188](https://cwe.mitre.org/data/definitions/188.html) | Reliance on Data/Memory Layout | Draft | Base | Architecture and Design; Implementation; Testing |
| [CWE-190](https://cwe.mitre.org/data/definitions/190.html) | Integer Overflow or Wraparound | Stable | Base | Architecture and Design; Implementation; Requirements |
| [CWE-191](https://cwe.mitre.org/data/definitions/191.html) | Integer Underflow (Wrap or Wraparound) | Draft | Base | — |
| [CWE-192](https://cwe.mitre.org/data/definitions/192.html) | Integer Coercion Error | Incomplete | Variant | Architecture and Design; Implementation; Requirements |
| [CWE-193](https://cwe.mitre.org/data/definitions/193.html) | Off-by-one Error | Draft | Base | Implementation |
| [CWE-194](https://cwe.mitre.org/data/definitions/194.html) | Unexpected Sign Extension | Incomplete | Variant | Implementation |
| [CWE-195](https://cwe.mitre.org/data/definitions/195.html) | Signed to Unsigned Conversion Error | Draft | Variant | — |
| [CWE-196](https://cwe.mitre.org/data/definitions/196.html) | Unsigned to Signed Conversion Error | Draft | Variant | Architecture and Design; Implementation; Requirements |
| [CWE-197](https://cwe.mitre.org/data/definitions/197.html) | Numeric Truncation Error | Incomplete | Base | Implementation |
| [CWE-198](https://cwe.mitre.org/data/definitions/198.html) | Use of Incorrect Byte Ordering | Draft | Variant | — |
| [CWE-200](https://cwe.mitre.org/data/definitions/200.html) | Exposure of Sensitive Information to an Unauthorized Actor | Draft | Class | Architecture and Design |
| [CWE-201](https://cwe.mitre.org/data/definitions/201.html) | Insertion of Sensitive Information Into Sent Data | Draft | Base | Architecture and Design; Implementation; Requirements; System Configuration |
| [CWE-202](https://cwe.mitre.org/data/definitions/202.html) | Exposure of Sensitive Information Through Data Queries | Draft | Base | Architecture and Design |
| [CWE-203](https://cwe.mitre.org/data/definitions/203.html) | Observable Discrepancy | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-204](https://cwe.mitre.org/data/definitions/204.html) | Observable Response Discrepancy | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-205](https://cwe.mitre.org/data/definitions/205.html) | Observable Behavioral Discrepancy | Incomplete | Base | Implementation |
| [CWE-206](https://cwe.mitre.org/data/definitions/206.html) | Observable Internal Behavioral Discrepancy | Incomplete | Variant | Implementation; Requirements; System Configuration |
| [CWE-207](https://cwe.mitre.org/data/definitions/207.html) | Observable Behavioral Discrepancy With Equivalent Products | Draft | Variant | — |
| [CWE-208](https://cwe.mitre.org/data/definitions/208.html) | Observable Timing Discrepancy | Incomplete | Base | — |
| [CWE-209](https://cwe.mitre.org/data/definitions/209.html) | Generation of Error Message Containing Sensitive Information | Draft | Base | Build and Compilation; Implementation; System Configuration |
| [CWE-210](https://cwe.mitre.org/data/definitions/210.html) | Self-generated Error Message Containing Sensitive Information | Draft | Base | Build and Compilation; Implementation |
| [CWE-211](https://cwe.mitre.org/data/definitions/211.html) | Externally-Generated Error Message Containing Sensitive Information | Incomplete | Base | Build and Compilation; Implementation; System Configuration |
| [CWE-212](https://cwe.mitre.org/data/definitions/212.html) | Improper Removal of Sensitive Information Before Storage or Transfer | Incomplete | Base | Architecture and Design; Implementation; Operation; Requirements |
| [CWE-213](https://cwe.mitre.org/data/definitions/213.html) | Exposure of Sensitive Information Due to Incompatible Policies | Draft | Base | Architecture and Design; Requirements |
| [CWE-214](https://cwe.mitre.org/data/definitions/214.html) | Invocation of Process Using Visible Sensitive Information | Incomplete | Base | — |
| [CWE-215](https://cwe.mitre.org/data/definitions/215.html) | Insertion of Sensitive Information Into Debugging Code | Draft | Base | Architecture and Design; Implementation |
| [CWE-216](https://cwe.mitre.org/data/definitions/216.html) | DEPRECATED: Containment Errors (Container Errors) | Deprecated | Class | — |
| [CWE-217](https://cwe.mitre.org/data/definitions/217.html) | DEPRECATED: Failure to Protect Stored Data from Modification | Deprecated | Base | — |
| [CWE-218](https://cwe.mitre.org/data/definitions/218.html) | DEPRECATED: Failure to provide confidentiality for stored data | Deprecated | Base | — |
| [CWE-219](https://cwe.mitre.org/data/definitions/219.html) | Storage of File with Sensitive Data Under Web Root | Draft | Variant | Implementation; System Configuration |
| [CWE-220](https://cwe.mitre.org/data/definitions/220.html) | Storage of File With Sensitive Data Under FTP Root | Draft | Variant | Implementation; System Configuration |
| [CWE-221](https://cwe.mitre.org/data/definitions/221.html) | Information Loss or Omission | Incomplete | Class | — |
| [CWE-222](https://cwe.mitre.org/data/definitions/222.html) | Truncation of Security-relevant Information | Draft | Base | — |
| [CWE-223](https://cwe.mitre.org/data/definitions/223.html) | Omission of Security-relevant Information | Draft | Base | — |
| [CWE-224](https://cwe.mitre.org/data/definitions/224.html) | Obscured Security-relevant Information by Alternate Name | Incomplete | Base | — |
| [CWE-225](https://cwe.mitre.org/data/definitions/225.html) | DEPRECATED: General Information Management Problems | Deprecated | Base | — |
| [CWE-226](https://cwe.mitre.org/data/definitions/226.html) | Sensitive Information in Resource Not Removed Before Reuse | Draft | Base | Architecture and Design; Implementation |
| [CWE-228](https://cwe.mitre.org/data/definitions/228.html) | Improper Handling of Syntactically Invalid Structure | Incomplete | Class | — |
| [CWE-229](https://cwe.mitre.org/data/definitions/229.html) | Improper Handling of Values | Incomplete | Base | — |
| [CWE-230](https://cwe.mitre.org/data/definitions/230.html) | Improper Handling of Missing Values | Draft | Variant | — |
| [CWE-231](https://cwe.mitre.org/data/definitions/231.html) | Improper Handling of Extra Values | Draft | Variant | — |
| [CWE-232](https://cwe.mitre.org/data/definitions/232.html) | Improper Handling of Undefined Values | Draft | Variant | — |
| [CWE-233](https://cwe.mitre.org/data/definitions/233.html) | Improper Handling of Parameters | Incomplete | Base | — |
| [CWE-234](https://cwe.mitre.org/data/definitions/234.html) | Failure to Handle Missing Parameter | Incomplete | Variant | Build and Compilation; Implementation |
| [CWE-235](https://cwe.mitre.org/data/definitions/235.html) | Improper Handling of Extra Parameters | Draft | Variant | — |
| [CWE-236](https://cwe.mitre.org/data/definitions/236.html) | Improper Handling of Undefined Parameters | Draft | Variant | — |
| [CWE-237](https://cwe.mitre.org/data/definitions/237.html) | Improper Handling of Structural Elements | Incomplete | Base | — |
| [CWE-238](https://cwe.mitre.org/data/definitions/238.html) | Improper Handling of Incomplete Structural Elements | Draft | Variant | — |
| [CWE-239](https://cwe.mitre.org/data/definitions/239.html) | Failure to Handle Incomplete Element | Draft | Variant | — |
| [CWE-240](https://cwe.mitre.org/data/definitions/240.html) | Improper Handling of Inconsistent Structural Elements | Draft | Class | — |
| [CWE-241](https://cwe.mitre.org/data/definitions/241.html) | Improper Handling of Unexpected Data Type | Draft | Base | Implementation |
| [CWE-242](https://cwe.mitre.org/data/definitions/242.html) | Use of Inherently Dangerous Function | Draft | Base | Build and Compilation; Implementation; Testing |
| [CWE-243](https://cwe.mitre.org/data/definitions/243.html) | Creation of chroot Jail Without Changing Working Directory | Draft | Variant | — |
| [CWE-244](https://cwe.mitre.org/data/definitions/244.html) | Improper Clearing of Heap Memory Before Release | Draft | Variant | — |
| [CWE-245](https://cwe.mitre.org/data/definitions/245.html) | J2EE Bad Practices: Direct Management of Connections | Draft | Variant | — |
| [CWE-246](https://cwe.mitre.org/data/definitions/246.html) | J2EE Bad Practices: Direct Use of Sockets | Draft | Variant | Architecture and Design |
| [CWE-247](https://cwe.mitre.org/data/definitions/247.html) | DEPRECATED: Reliance on DNS Lookups in a Security Decision | Deprecated | Base | — |
| [CWE-248](https://cwe.mitre.org/data/definitions/248.html) | Uncaught Exception | Draft | Base | Implementation; Requirements |
| [CWE-249](https://cwe.mitre.org/data/definitions/249.html) | DEPRECATED: Often Misused: Path Manipulation | Deprecated | Variant | — |
| [CWE-250](https://cwe.mitre.org/data/definitions/250.html) | Execution with Unnecessary Privileges | Draft | Base | Architecture and Design; Implementation; Operation; System Configuration |
| [CWE-252](https://cwe.mitre.org/data/definitions/252.html) | Unchecked Return Value | Draft | Base | Implementation |
| [CWE-253](https://cwe.mitre.org/data/definitions/253.html) | Incorrect Check of Function Return Value | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-256](https://cwe.mitre.org/data/definitions/256.html) | Plaintext Storage of a Password | Incomplete | Base | Architecture and Design |
| [CWE-257](https://cwe.mitre.org/data/definitions/257.html) | Storing Passwords in a Recoverable Format | Incomplete | Base | Architecture and Design |
| [CWE-258](https://cwe.mitre.org/data/definitions/258.html) | Empty Password in Configuration File | Incomplete | Variant | System Configuration |
| [CWE-259](https://cwe.mitre.org/data/definitions/259.html) | Use of Hard-coded Password | Draft | Variant | Architecture and Design |
| [CWE-260](https://cwe.mitre.org/data/definitions/260.html) | Password in Configuration File | Incomplete | Base | Architecture and Design |
| [CWE-261](https://cwe.mitre.org/data/definitions/261.html) | Weak Encoding for Password | Incomplete | Base | — |
| [CWE-262](https://cwe.mitre.org/data/definitions/262.html) | Not Using Password Aging | Draft | Base | Architecture and Design; Implementation |
| [CWE-263](https://cwe.mitre.org/data/definitions/263.html) | Password Aging with Long Expiration | Draft | Base | Architecture and Design; Implementation |
| [CWE-266](https://cwe.mitre.org/data/definitions/266.html) | Incorrect Privilege Assignment | Draft | Base | Architecture and Design; Operation |
| [CWE-267](https://cwe.mitre.org/data/definitions/267.html) | Privilege Defined With Unsafe Actions | Incomplete | Base | Architecture and Design; Operation |
| [CWE-268](https://cwe.mitre.org/data/definitions/268.html) | Privilege Chaining | Draft | Base | Architecture and Design; Operation |
| [CWE-269](https://cwe.mitre.org/data/definitions/269.html) | Improper Privilege Management | Draft | Class | Architecture and Design; Operation |
| [CWE-270](https://cwe.mitre.org/data/definitions/270.html) | Privilege Context Switching Error | Draft | Base | Architecture and Design; Operation |
| [CWE-271](https://cwe.mitre.org/data/definitions/271.html) | Privilege Dropping / Lowering Errors | Incomplete | Class | Architecture and Design; Operation |
| [CWE-272](https://cwe.mitre.org/data/definitions/272.html) | Least Privilege Violation | Incomplete | Base | Architecture and Design; Operation |
| [CWE-273](https://cwe.mitre.org/data/definitions/273.html) | Improper Check for Dropped Privileges | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-274](https://cwe.mitre.org/data/definitions/274.html) | Improper Handling of Insufficient Privileges | Draft | Base | — |
| [CWE-276](https://cwe.mitre.org/data/definitions/276.html) | Incorrect Default Permissions | Draft | Base | Architecture and Design; Operation |
| [CWE-277](https://cwe.mitre.org/data/definitions/277.html) | Insecure Inherited Permissions | Draft | Variant | Architecture and Design; Operation |
| [CWE-278](https://cwe.mitre.org/data/definitions/278.html) | Insecure Preserved Inherited Permissions | Incomplete | Variant | Architecture and Design; Operation |
| [CWE-279](https://cwe.mitre.org/data/definitions/279.html) | Incorrect Execution-Assigned Permissions | Draft | Variant | Architecture and Design; Operation |
| [CWE-280](https://cwe.mitre.org/data/definitions/280.html) | Improper Handling of Insufficient Permissions or Privileges | Draft | Base | Architecture and Design; Implementation |
| [CWE-281](https://cwe.mitre.org/data/definitions/281.html) | Improper Preservation of Permissions | Draft | Base | — |
| [CWE-282](https://cwe.mitre.org/data/definitions/282.html) | Improper Ownership Management | Draft | Class | Architecture and Design; Operation |
| [CWE-283](https://cwe.mitre.org/data/definitions/283.html) | Unverified Ownership | Draft | Base | Architecture and Design; Operation |
| [CWE-284](https://cwe.mitre.org/data/definitions/284.html) | Improper Access Control | Incomplete | Pillar | Architecture and Design; Operation |
| [CWE-285](https://cwe.mitre.org/data/definitions/285.html) | Improper Authorization | Draft | Class | Architecture and Design; Installation; System Configuration |
| [CWE-286](https://cwe.mitre.org/data/definitions/286.html) | Incorrect User Management | Incomplete | Class | — |
| [CWE-287](https://cwe.mitre.org/data/definitions/287.html) | Improper Authentication | Draft | Class | Architecture and Design |
| [CWE-288](https://cwe.mitre.org/data/definitions/288.html) | Authentication Bypass Using an Alternate Path or Channel | Incomplete | Base | Architecture and Design |
| [CWE-289](https://cwe.mitre.org/data/definitions/289.html) | Authentication Bypass by Alternate Name | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-290](https://cwe.mitre.org/data/definitions/290.html) | Authentication Bypass by Spoofing | Incomplete | Base | — |
| [CWE-291](https://cwe.mitre.org/data/definitions/291.html) | Reliance on IP Address for Authentication | Incomplete | Variant | Architecture and Design |
| [CWE-292](https://cwe.mitre.org/data/definitions/292.html) | DEPRECATED: Trusting Self-reported DNS Name | Deprecated | Variant | — |
| [CWE-293](https://cwe.mitre.org/data/definitions/293.html) | Using Referer Field for Authentication | Draft | Variant | Architecture and Design |
| [CWE-294](https://cwe.mitre.org/data/definitions/294.html) | Authentication Bypass by Capture-replay | Incomplete | Base | Architecture and Design |
| [CWE-295](https://cwe.mitre.org/data/definitions/295.html) | Improper Certificate Validation | Draft | Base | Architecture and Design; Implementation |
| [CWE-296](https://cwe.mitre.org/data/definitions/296.html) | Improper Following of a Certificate's Chain of Trust | Draft | Base | Architecture and Design; Implementation |
| [CWE-297](https://cwe.mitre.org/data/definitions/297.html) | Improper Validation of Certificate with Host Mismatch | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-298](https://cwe.mitre.org/data/definitions/298.html) | Improper Validation of Certificate Expiration | Draft | Variant | Architecture and Design; Implementation |
| [CWE-299](https://cwe.mitre.org/data/definitions/299.html) | Improper Check for Certificate Revocation | Draft | Base | Architecture and Design; Implementation |
| [CWE-300](https://cwe.mitre.org/data/definitions/300.html) | Channel Accessible by Non-Endpoint | Draft | Class | Architecture and Design; Implementation |
| [CWE-301](https://cwe.mitre.org/data/definitions/301.html) | Reflection Attack in an Authentication Protocol | Draft | Base | Architecture and Design |
| [CWE-302](https://cwe.mitre.org/data/definitions/302.html) | Authentication Bypass by Assumed-Immutable Data | Incomplete | Base | Architecture and Design; Implementation; Operation |
| [CWE-303](https://cwe.mitre.org/data/definitions/303.html) | Incorrect Implementation of Authentication Algorithm | Draft | Base | — |
| [CWE-304](https://cwe.mitre.org/data/definitions/304.html) | Missing Critical Step in Authentication | Draft | Base | — |
| [CWE-305](https://cwe.mitre.org/data/definitions/305.html) | Authentication Bypass by Primary Weakness | Draft | Base | — |
| [CWE-306](https://cwe.mitre.org/data/definitions/306.html) | Missing Authentication for Critical Functionality | Draft | Base | Architecture and Design; Implementation; Operation; System Configuration |
| [CWE-307](https://cwe.mitre.org/data/definitions/307.html) | Improper Restriction of Excessive Authentication Attempts | Draft | Base | Architecture and Design |
| [CWE-308](https://cwe.mitre.org/data/definitions/308.html) | Use of Single-factor Authentication | Draft | Base | Architecture and Design |
| [CWE-309](https://cwe.mitre.org/data/definitions/309.html) | Use of Password System for Primary Authentication | Draft | Base | Architecture and Design |
| [CWE-311](https://cwe.mitre.org/data/definitions/311.html) | Missing Encryption of Sensitive Data | Draft | Class | Architecture and Design; Implementation; Requirements |
| [CWE-312](https://cwe.mitre.org/data/definitions/312.html) | Cleartext Storage of Sensitive Information | Draft | Base | Implementation; Operation; System Configuration |
| [CWE-313](https://cwe.mitre.org/data/definitions/313.html) | Cleartext Storage in a File or on Disk | Draft | Variant | — |
| [CWE-314](https://cwe.mitre.org/data/definitions/314.html) | Cleartext Storage in the Registry | Draft | Variant | — |
| [CWE-315](https://cwe.mitre.org/data/definitions/315.html) | Cleartext Storage of Sensitive Information in a Cookie | Draft | Variant | — |
| [CWE-316](https://cwe.mitre.org/data/definitions/316.html) | Cleartext Storage of Sensitive Information in Memory | Draft | Variant | — |
| [CWE-317](https://cwe.mitre.org/data/definitions/317.html) | Cleartext Storage of Sensitive Information in GUI | Draft | Variant | — |
| [CWE-318](https://cwe.mitre.org/data/definitions/318.html) | Cleartext Storage of Sensitive Information in Executable | Draft | Variant | — |
| [CWE-319](https://cwe.mitre.org/data/definitions/319.html) | Cleartext Transmission of Sensitive Information | Draft | Base | Architecture and Design; Implementation; Operation; Testing |
| [CWE-321](https://cwe.mitre.org/data/definitions/321.html) | Use of Hard-coded Cryptographic Key | Draft | Variant | Architecture and Design |
| [CWE-322](https://cwe.mitre.org/data/definitions/322.html) | Key Exchange without Entity Authentication | Draft | Base | Architecture and Design; Implementation |
| [CWE-323](https://cwe.mitre.org/data/definitions/323.html) | Reusing a Nonce, Key Pair in Encryption | Incomplete | Base | Implementation |
| [CWE-324](https://cwe.mitre.org/data/definitions/324.html) | Use of a Key Past its Expiration Date | Draft | Base | Architecture and Design; Implementation |
| [CWE-325](https://cwe.mitre.org/data/definitions/325.html) | Missing Cryptographic Step | Draft | Base | — |
| [CWE-326](https://cwe.mitre.org/data/definitions/326.html) | Inadequate Encryption Strength | Draft | Class | Architecture and Design |
| [CWE-327](https://cwe.mitre.org/data/definitions/327.html) | Use of a Broken or Risky Cryptographic Algorithm | Draft | Class | Architecture and Design; Implementation |
| [CWE-328](https://cwe.mitre.org/data/definitions/328.html) | Use of Weak Hash | Draft | Base | Architecture and Design |
| [CWE-329](https://cwe.mitre.org/data/definitions/329.html) | Generation of Predictable IV with CBC Mode | Draft | Variant | Implementation |
| [CWE-330](https://cwe.mitre.org/data/definitions/330.html) | Use of Insufficiently Random Values | Stable | Class | Architecture and Design; Implementation; Requirements |
| [CWE-331](https://cwe.mitre.org/data/definitions/331.html) | Insufficient Entropy | Draft | Base | Implementation |
| [CWE-332](https://cwe.mitre.org/data/definitions/332.html) | Insufficient Entropy in PRNG | Draft | Variant | Architecture and Design; Implementation; Requirements |
| [CWE-333](https://cwe.mitre.org/data/definitions/333.html) | Improper Handling of Insufficient Entropy in TRNG | Draft | Variant | Implementation |
| [CWE-334](https://cwe.mitre.org/data/definitions/334.html) | Small Space of Random Values | Draft | Base | Architecture and Design; Requirements |
| [CWE-335](https://cwe.mitre.org/data/definitions/335.html) | Incorrect Usage of Seeds in Pseudo-Random Number Generator (PRNG) | Draft | Base | — |
| [CWE-336](https://cwe.mitre.org/data/definitions/336.html) | Same Seed in Pseudo-Random Number Generator (PRNG) | Draft | Variant | Architecture and Design; Requirements |
| [CWE-337](https://cwe.mitre.org/data/definitions/337.html) | Predictable Seed in Pseudo-Random Number Generator (PRNG) | Draft | Variant | Architecture and Design; Implementation; Requirements |
| [CWE-338](https://cwe.mitre.org/data/definitions/338.html) | Use of Cryptographically Weak Pseudo-Random Number Generator (PRNG) | Draft | Base | Implementation |
| [CWE-339](https://cwe.mitre.org/data/definitions/339.html) | Small Seed Space in PRNG | Draft | Variant | Architecture and Design; Requirements |
| [CWE-340](https://cwe.mitre.org/data/definitions/340.html) | Generation of Predictable Numbers or Identifiers | Incomplete | Class | — |
| [CWE-341](https://cwe.mitre.org/data/definitions/341.html) | Predictable from Observable State | Draft | Base | Architecture and Design; Implementation; Requirements |
| [CWE-342](https://cwe.mitre.org/data/definitions/342.html) | Predictable Exact Value from Previous Values | Draft | Base | Architecture and Design; Implementation; Requirements |
| [CWE-343](https://cwe.mitre.org/data/definitions/343.html) | Predictable Value Range from Previous Values | Draft | Base | Architecture and Design; Implementation; Requirements |
| [CWE-344](https://cwe.mitre.org/data/definitions/344.html) | Use of Invariant Value in Dynamically Changing Context | Draft | Base | — |
| [CWE-345](https://cwe.mitre.org/data/definitions/345.html) | Insufficient Verification of Data Authenticity | Draft | Class | — |
| [CWE-346](https://cwe.mitre.org/data/definitions/346.html) | Origin Validation Error | Draft | Class | — |
| [CWE-347](https://cwe.mitre.org/data/definitions/347.html) | Improper Verification of Cryptographic Signature | Draft | Base | — |
| [CWE-348](https://cwe.mitre.org/data/definitions/348.html) | Use of Less Trusted Source | Draft | Base | — |
| [CWE-349](https://cwe.mitre.org/data/definitions/349.html) | Acceptance of Extraneous Untrusted Data With Trusted Data | Draft | Base | — |
| [CWE-350](https://cwe.mitre.org/data/definitions/350.html) | Reliance on Reverse DNS Resolution for a Security-Critical Action | Draft | Variant | Architecture and Design; Implementation |
| [CWE-351](https://cwe.mitre.org/data/definitions/351.html) | Insufficient Type Distinction | Draft | Base | — |
| [CWE-352](https://cwe.mitre.org/data/definitions/352.html) | Cross-Site Request Forgery | Stable | Compound | Architecture and Design; Implementation |
| [CWE-353](https://cwe.mitre.org/data/definitions/353.html) | Missing Support for Integrity Check | Draft | Base | Architecture and Design; Implementation |
| [CWE-354](https://cwe.mitre.org/data/definitions/354.html) | Improper Validation of Integrity Check Value | Draft | Base | Implementation |
| [CWE-356](https://cwe.mitre.org/data/definitions/356.html) | Missing User Interaction for Potentially Unsafe Action | Incomplete | Base | Architecture and Design |
| [CWE-357](https://cwe.mitre.org/data/definitions/357.html) | Insufficient UI Warning of Dangerous Operations | Draft | Base | — |
| [CWE-358](https://cwe.mitre.org/data/definitions/358.html) | Improperly Implemented Security Check for Standard | Draft | Base | — |
| [CWE-359](https://cwe.mitre.org/data/definitions/359.html) | Exposure of Private Personal Information to an Unauthorized Actor | Incomplete | Base | Architecture and Design; Implementation; Operation; Requirements |
| [CWE-360](https://cwe.mitre.org/data/definitions/360.html) | Trust of System Event Data | Incomplete | Base | Architecture and Design |
| [CWE-362](https://cwe.mitre.org/data/definitions/362.html) | Concurrent Execution using Shared Resource with Improper Synchronization | Draft | Class | Architecture and Design; Implementation; Operation |
| [CWE-363](https://cwe.mitre.org/data/definitions/363.html) | Race Condition Enabling Link Following | Draft | Base | — |
| [CWE-364](https://cwe.mitre.org/data/definitions/364.html) | Signal Handler Race Condition | Incomplete | Base | Architecture and Design; Implementation; Requirements |
| [CWE-365](https://cwe.mitre.org/data/definitions/365.html) | DEPRECATED: Race Condition in Switch | Deprecated | Base | — |
| [CWE-366](https://cwe.mitre.org/data/definitions/366.html) | Race Condition within a Thread | Draft | Base | Architecture and Design |
| [CWE-367](https://cwe.mitre.org/data/definitions/367.html) | Time-of-check Time-of-use (TOCTOU) Race Condition | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-368](https://cwe.mitre.org/data/definitions/368.html) | Context Switching Race Condition | Draft | Base | — |
| [CWE-369](https://cwe.mitre.org/data/definitions/369.html) | Divide By Zero | Draft | Base | — |
| [CWE-370](https://cwe.mitre.org/data/definitions/370.html) | Missing Check for Certificate Revocation after Initial Check | Draft | Variant | Architecture and Design |
| [CWE-372](https://cwe.mitre.org/data/definitions/372.html) | Incomplete Internal State Distinction | Draft | Class | — |
| [CWE-373](https://cwe.mitre.org/data/definitions/373.html) | DEPRECATED: State Synchronization Error | Deprecated | Base | — |
| [CWE-374](https://cwe.mitre.org/data/definitions/374.html) | Passing Mutable Objects to an Untrusted Method | Draft | Base | Implementation |
| [CWE-375](https://cwe.mitre.org/data/definitions/375.html) | Returning a Mutable Object to an Untrusted Caller | Draft | Base | Implementation |
| [CWE-377](https://cwe.mitre.org/data/definitions/377.html) | DEPRECATED: Insecure Temporary File | Deprecated | Class | — |
| [CWE-378](https://cwe.mitre.org/data/definitions/378.html) | Creation of Temporary File With Insecure Permissions | Draft | Base | Implementation; Requirements |
| [CWE-379](https://cwe.mitre.org/data/definitions/379.html) | Creation of Temporary File in Directory with Insecure Permissions | Incomplete | Base | Implementation; Requirements |
| [CWE-382](https://cwe.mitre.org/data/definitions/382.html) | J2EE Bad Practices: Use of System.exit() | Draft | Variant | Architecture and Design; Implementation |
| [CWE-383](https://cwe.mitre.org/data/definitions/383.html) | J2EE Bad Practices: Direct Use of Threads | Draft | Variant | Architecture and Design |
| [CWE-384](https://cwe.mitre.org/data/definitions/384.html) | Session Fixation | Incomplete | Compound | Architecture and Design; Operation |
| [CWE-385](https://cwe.mitre.org/data/definitions/385.html) | Covert Timing Channel | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-386](https://cwe.mitre.org/data/definitions/386.html) | Symbolic Name not Mapping to Correct Object | Draft | Base | — |
| [CWE-390](https://cwe.mitre.org/data/definitions/390.html) | Detection of Error Condition Without Action | Draft | Base | Implementation; Testing |
| [CWE-391](https://cwe.mitre.org/data/definitions/391.html) | DEPRECATED: Unchecked Error Condition | Deprecated | Base | — |
| [CWE-392](https://cwe.mitre.org/data/definitions/392.html) | Missing Report of Error Condition | Draft | Base | — |
| [CWE-393](https://cwe.mitre.org/data/definitions/393.html) | Return of Wrong Status Code | Draft | Base | — |
| [CWE-394](https://cwe.mitre.org/data/definitions/394.html) | Unexpected Status Code or Return Value | Draft | Base | — |
| [CWE-395](https://cwe.mitre.org/data/definitions/395.html) | Use of NullPointerException Catch to Detect NULL Pointer Dereference | Draft | Variant | Architecture and Design; Implementation |
| [CWE-396](https://cwe.mitre.org/data/definitions/396.html) | Declaration of Catch for Generic Exception | Draft | Base | — |
| [CWE-397](https://cwe.mitre.org/data/definitions/397.html) | Declaration of Throws for Generic Exception | Draft | Base | — |
| [CWE-400](https://cwe.mitre.org/data/definitions/400.html) | Uncontrolled Resource Consumption | Draft | Class | Architecture and Design; Implementation |
| [CWE-401](https://cwe.mitre.org/data/definitions/401.html) | Missing Release of Memory after Effective Lifetime | Draft | Variant | Architecture and Design; Build and Compilation; Implementation |
| [CWE-402](https://cwe.mitre.org/data/definitions/402.html) | Transmission of Private Resources into a New Sphere | Draft | Class | — |
| [CWE-403](https://cwe.mitre.org/data/definitions/403.html) | Exposure of File Descriptor to Unintended Control Sphere | Draft | Base | — |
| [CWE-404](https://cwe.mitre.org/data/definitions/404.html) | Improper Resource Shutdown or Release | Draft | Class | Implementation; Requirements |
| [CWE-405](https://cwe.mitre.org/data/definitions/405.html) | Asymmetric Resource Consumption (Amplification) | Incomplete | Class | Architecture and Design; System Configuration |
| [CWE-406](https://cwe.mitre.org/data/definitions/406.html) | Insufficient Control of Network Message Volume (Network Amplification) | Incomplete | Class | Architecture and Design; Implementation; Policy |
| [CWE-407](https://cwe.mitre.org/data/definitions/407.html) | Inefficient Algorithmic Complexity | Incomplete | Class | — |
| [CWE-408](https://cwe.mitre.org/data/definitions/408.html) | Incorrect Behavior Order: Early Amplification | Draft | Base | — |
| [CWE-409](https://cwe.mitre.org/data/definitions/409.html) | Improper Handling of Highly Compressed Data (Data Amplification) | Incomplete | Base | — |
| [CWE-410](https://cwe.mitre.org/data/definitions/410.html) | Insufficient Resource Pool | Incomplete | Class | Architecture and Design; Implementation; Operation |
| [CWE-412](https://cwe.mitre.org/data/definitions/412.html) | Unrestricted Externally Accessible Lock | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-413](https://cwe.mitre.org/data/definitions/413.html) | Improper Resource Locking | Draft | Base | Architecture and Design; Implementation |
| [CWE-414](https://cwe.mitre.org/data/definitions/414.html) | Missing Lock Check | Draft | Base | Architecture and Design; Implementation |
| [CWE-415](https://cwe.mitre.org/data/definitions/415.html) | Double Free | Draft | Variant | Architecture and Design; Implementation |
| [CWE-416](https://cwe.mitre.org/data/definitions/416.html) | Use After Free | Stable | Variant | Architecture and Design; Implementation |
| [CWE-419](https://cwe.mitre.org/data/definitions/419.html) | Unprotected Primary Channel | Draft | Base | Architecture and Design |
| [CWE-420](https://cwe.mitre.org/data/definitions/420.html) | Unprotected Alternate Channel | Draft | Base | Architecture and Design |
| [CWE-421](https://cwe.mitre.org/data/definitions/421.html) | Race Condition During Access to Alternate Channel | Draft | Base | — |
| [CWE-422](https://cwe.mitre.org/data/definitions/422.html) | Unprotected Windows Messaging Channel | Draft | Variant | Architecture and Design |
| [CWE-423](https://cwe.mitre.org/data/definitions/423.html) | DEPRECATED: Proxied Trusted Channel | Deprecated | Base | — |
| [CWE-424](https://cwe.mitre.org/data/definitions/424.html) | Improper Protection of Alternate Path | Draft | Class | Architecture and Design |
| [CWE-425](https://cwe.mitre.org/data/definitions/425.html) | Direct Request | Incomplete | Base | Architecture and Design; Operation |
| [CWE-426](https://cwe.mitre.org/data/definitions/426.html) | Untrusted Search Path | Stable | Base | Architecture and Design; Implementation |
| [CWE-427](https://cwe.mitre.org/data/definitions/427.html) | Uncontrolled Search Path Element | Draft | Base | Architecture and Design; Implementation |
| [CWE-428](https://cwe.mitre.org/data/definitions/428.html) | Unquoted Search Path or Element | Draft | Base | Implementation |
| [CWE-430](https://cwe.mitre.org/data/definitions/430.html) | Deployment of Wrong Handler | Incomplete | Base | Architecture and Design |
| [CWE-431](https://cwe.mitre.org/data/definitions/431.html) | Missing Handler | Draft | Base | Implementation |
| [CWE-432](https://cwe.mitre.org/data/definitions/432.html) | Dangerous Signal Handler not Disabled During Sensitive Operations | Draft | Base | Implementation |
| [CWE-433](https://cwe.mitre.org/data/definitions/433.html) | Unparsed Raw Web Content Delivery | Incomplete | Variant | Architecture and Design |
| [CWE-434](https://cwe.mitre.org/data/definitions/434.html) | Unrestricted Upload of File with Dangerous Type | Draft | Base | Architecture and Design; Implementation; Operation |
| [CWE-435](https://cwe.mitre.org/data/definitions/435.html) | Improper Interaction Between Multiple Correctly-Behaving Entities | Draft | Pillar | — |
| [CWE-436](https://cwe.mitre.org/data/definitions/436.html) | Interpretation Conflict | Incomplete | Class | — |
| [CWE-437](https://cwe.mitre.org/data/definitions/437.html) | Incomplete Model of Endpoint Features | Incomplete | Base | — |
| [CWE-439](https://cwe.mitre.org/data/definitions/439.html) | Behavioral Change in New Version or Environment | Draft | Base | — |
| [CWE-440](https://cwe.mitre.org/data/definitions/440.html) | Expected Behavior Violation | Draft | Base | — |
| [CWE-441](https://cwe.mitre.org/data/definitions/441.html) | Unintended Proxy or Intermediary | Draft | Class | Architecture and Design |
| [CWE-443](https://cwe.mitre.org/data/definitions/443.html) | DEPRECATED: HTTP response splitting | Deprecated | Base | — |
| [CWE-444](https://cwe.mitre.org/data/definitions/444.html) | Inconsistent Interpretation of HTTP Requests | Incomplete | Base | Implementation; System Configuration |
| [CWE-446](https://cwe.mitre.org/data/definitions/446.html) | UI Discrepancy for Security Feature | Incomplete | Class | — |
| [CWE-447](https://cwe.mitre.org/data/definitions/447.html) | Unimplemented or Unsupported Feature in UI | Draft | Base | Testing |
| [CWE-448](https://cwe.mitre.org/data/definitions/448.html) | Obsolete Feature in UI | Draft | Base | Architecture and Design |
| [CWE-449](https://cwe.mitre.org/data/definitions/449.html) | The UI Performs the Wrong Action | Incomplete | Base | — |
| [CWE-450](https://cwe.mitre.org/data/definitions/450.html) | Multiple Interpretations of UI Input | Draft | Base | Implementation |
| [CWE-451](https://cwe.mitre.org/data/definitions/451.html) | User Interface (UI) Misrepresentation of Critical Information | Draft | Class | Architecture and Design; Implementation |
| [CWE-453](https://cwe.mitre.org/data/definitions/453.html) | Insecure Default Variable Initialization | Draft | Variant | System Configuration |
| [CWE-454](https://cwe.mitre.org/data/definitions/454.html) | External Initialization of Trusted Variables or Data Stores | Draft | Base | Architecture and Design; Implementation |
| [CWE-455](https://cwe.mitre.org/data/definitions/455.html) | Non-exit on Failed Initialization | Draft | Class | Implementation |
| [CWE-456](https://cwe.mitre.org/data/definitions/456.html) | Missing Initialization of a Variable | Draft | Variant | Implementation; Requirements |
| [CWE-457](https://cwe.mitre.org/data/definitions/457.html) | Use of Uninitialized Variable | Draft | Variant | Architecture and Design; Build and Compilation; Implementation; Operation; Requirements |
| [CWE-458](https://cwe.mitre.org/data/definitions/458.html) | DEPRECATED: Incorrect Initialization | Deprecated | Base | — |
| [CWE-459](https://cwe.mitre.org/data/definitions/459.html) | Incomplete Cleanup | Draft | Base | Architecture and Design; Implementation |
| [CWE-460](https://cwe.mitre.org/data/definitions/460.html) | Improper Cleanup on Thrown Exception | Draft | Base | Implementation |
| [CWE-462](https://cwe.mitre.org/data/definitions/462.html) | Duplicate Key in Associative List (Alist) | Incomplete | Variant | Implementation |
| [CWE-463](https://cwe.mitre.org/data/definitions/463.html) | Deletion of Data Structure Sentinel | Incomplete | Base | Architecture and Design; Build and Compilation; Operation |
| [CWE-464](https://cwe.mitre.org/data/definitions/464.html) | Addition of Data Structure Sentinel | Incomplete | Base | Architecture and Design; Implementation; Operation |
| [CWE-466](https://cwe.mitre.org/data/definitions/466.html) | Return of Pointer Value Outside of Expected Range | Draft | Base | — |
| [CWE-467](https://cwe.mitre.org/data/definitions/467.html) | Use of sizeof() on a Pointer Type | Draft | Variant | Implementation |
| [CWE-468](https://cwe.mitre.org/data/definitions/468.html) | Incorrect Pointer Scaling | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-469](https://cwe.mitre.org/data/definitions/469.html) | Use of Pointer Subtraction to Determine Size | Draft | Base | Implementation |
| [CWE-470](https://cwe.mitre.org/data/definitions/470.html) | Use of Externally-Controlled Input to Select Classes or Code | Draft | Base | Architecture and Design; Implementation |
| [CWE-471](https://cwe.mitre.org/data/definitions/471.html) | Modification of Assumed-Immutable Data (MAID) | Draft | Base | Architecture and Design; Implementation; Operation |
| [CWE-472](https://cwe.mitre.org/data/definitions/472.html) | External Control of Assumed-Immutable Web Parameter | Draft | Base | Implementation |
| [CWE-473](https://cwe.mitre.org/data/definitions/473.html) | PHP External Variable Modification | Draft | Variant | Implementation; Requirements |
| [CWE-474](https://cwe.mitre.org/data/definitions/474.html) | Use of Function with Inconsistent Implementations | Draft | Base | Architecture and Design; Requirements |
| [CWE-475](https://cwe.mitre.org/data/definitions/475.html) | Undefined Behavior for Input to API | Incomplete | Base | — |
| [CWE-476](https://cwe.mitre.org/data/definitions/476.html) | NULL Pointer Dereference | Stable | Base | Architecture and Design; Implementation; Requirements |
| [CWE-477](https://cwe.mitre.org/data/definitions/477.html) | Use of Obsolete Function | Draft | Base | Implementation; Requirements |
| [CWE-478](https://cwe.mitre.org/data/definitions/478.html) | Missing Default Case in Multiple Condition Expression | Draft | Base | Implementation |
| [CWE-479](https://cwe.mitre.org/data/definitions/479.html) | Signal Handler Use of a Non-reentrant Function | Draft | Variant | Architecture and Design; Implementation; Requirements |
| [CWE-480](https://cwe.mitre.org/data/definitions/480.html) | Use of Incorrect Operator | Draft | Base | — |
| [CWE-481](https://cwe.mitre.org/data/definitions/481.html) | Assigning instead of Comparing | Draft | Variant | Implementation |
| [CWE-482](https://cwe.mitre.org/data/definitions/482.html) | Comparing instead of Assigning | Draft | Variant | Testing |
| [CWE-483](https://cwe.mitre.org/data/definitions/483.html) | Incorrect Block Delimitation | Draft | Base | Implementation |
| [CWE-484](https://cwe.mitre.org/data/definitions/484.html) | Omitted Break Statement in Switch | Draft | Base | Implementation |
| [CWE-486](https://cwe.mitre.org/data/definitions/486.html) | Comparison of Classes by Name | Draft | Variant | Implementation |
| [CWE-487](https://cwe.mitre.org/data/definitions/487.html) | Reliance on Package-level Scope | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-488](https://cwe.mitre.org/data/definitions/488.html) | Exposure of Data Element to Wrong Session | Draft | Base | Architecture and Design; Testing |
| [CWE-489](https://cwe.mitre.org/data/definitions/489.html) | Active Debug Code | Draft | Base | Build and Compilation; Distribution |
| [CWE-491](https://cwe.mitre.org/data/definitions/491.html) | Public cloneable() Method Without Final | Draft | Variant | Implementation |
| [CWE-492](https://cwe.mitre.org/data/definitions/492.html) | Use of Inner Class Containing Sensitive Data | Draft | Variant | Implementation |
| [CWE-493](https://cwe.mitre.org/data/definitions/493.html) | Critical Public Variable Without Final Modifier | Draft | Variant | Implementation |
| [CWE-494](https://cwe.mitre.org/data/definitions/494.html) | Download of Code Without Integrity Check | Draft | Base | Architecture and Design; Implementation; Operation |
| [CWE-495](https://cwe.mitre.org/data/definitions/495.html) | Private Data Structure Returned From A Public Method | Draft | Variant | Implementation |
| [CWE-496](https://cwe.mitre.org/data/definitions/496.html) | Public Data Assigned to Private Array-Typed Field | Incomplete | Variant | Implementation |
| [CWE-497](https://cwe.mitre.org/data/definitions/497.html) | Exposure of Sensitive System Information to an Unauthorized Control Sphere | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-498](https://cwe.mitre.org/data/definitions/498.html) | Cloneable Class Containing Sensitive Information | Draft | Variant | Implementation |
| [CWE-499](https://cwe.mitre.org/data/definitions/499.html) | Serializable Class Containing Sensitive Data | Draft | Variant | Implementation |
| [CWE-500](https://cwe.mitre.org/data/definitions/500.html) | Public Static Field Not Marked Final | Draft | Variant | Architecture and Design; Implementation |
| [CWE-501](https://cwe.mitre.org/data/definitions/501.html) | Trust Boundary Violation | Draft | Class | — |
| [CWE-502](https://cwe.mitre.org/data/definitions/502.html) | Deserialization of Untrusted Data | Draft | Base | Architecture and Design; Implementation; Operation |
| [CWE-506](https://cwe.mitre.org/data/definitions/506.html) | Embedded Malicious Code | Incomplete | Class | Implementation; Operation |
| [CWE-507](https://cwe.mitre.org/data/definitions/507.html) | Trojan Horse | Incomplete | Base | Installation; Operation |
| [CWE-508](https://cwe.mitre.org/data/definitions/508.html) | Non-Replicating Malicious Code | Incomplete | Base | Installation; Operation |
| [CWE-509](https://cwe.mitre.org/data/definitions/509.html) | Replicating Malicious Code (Virus or Worm) | Incomplete | Base | Installation; Operation |
| [CWE-510](https://cwe.mitre.org/data/definitions/510.html) | Trapdoor | Incomplete | Base | Installation; Testing |
| [CWE-511](https://cwe.mitre.org/data/definitions/511.html) | Logic/Time Bomb | Incomplete | Base | Installation |
| [CWE-512](https://cwe.mitre.org/data/definitions/512.html) | Spyware | Incomplete | Base | Installation; Operation |
| [CWE-514](https://cwe.mitre.org/data/definitions/514.html) | Covert Channel | Incomplete | Class | — |
| [CWE-515](https://cwe.mitre.org/data/definitions/515.html) | Covert Storage Channel | Incomplete | Base | Implementation |
| [CWE-516](https://cwe.mitre.org/data/definitions/516.html) | DEPRECATED: Covert Timing Channel | Deprecated | Base | — |
| [CWE-520](https://cwe.mitre.org/data/definitions/520.html) | .NET Misconfiguration: Use of Impersonation | Incomplete | Variant | Operation |
| [CWE-521](https://cwe.mitre.org/data/definitions/521.html) | Weak Password Requirements | Draft | Base | Architecture and Design; Implementation |
| [CWE-522](https://cwe.mitre.org/data/definitions/522.html) | Insufficiently Protected Credentials | Incomplete | Class | Architecture and Design; Implementation |
| [CWE-523](https://cwe.mitre.org/data/definitions/523.html) | Unprotected Transport of Credentials | Incomplete | Base | Operation; System Configuration |
| [CWE-524](https://cwe.mitre.org/data/definitions/524.html) | Use of Cache Containing Sensitive Information | Incomplete | Base | Architecture and Design |
| [CWE-525](https://cwe.mitre.org/data/definitions/525.html) | Use of Web Browser Cache Containing Sensitive Information | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-526](https://cwe.mitre.org/data/definitions/526.html) | Cleartext Storage of Sensitive Information in an Environment Variable | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-527](https://cwe.mitre.org/data/definitions/527.html) | Exposure of Version-Control Repository to an Unauthorized Control Sphere | Incomplete | Variant | Distribution; Operation; System Configuration |
| [CWE-528](https://cwe.mitre.org/data/definitions/528.html) | Exposure of Core Dump File to an Unauthorized Control Sphere | Draft | Variant | System Configuration |
| [CWE-529](https://cwe.mitre.org/data/definitions/529.html) | Exposure of Access Control List Files to an Unauthorized Control Sphere | Incomplete | Variant | System Configuration |
| [CWE-530](https://cwe.mitre.org/data/definitions/530.html) | Exposure of Backup File to an Unauthorized Control Sphere | Incomplete | Variant | Policy |
| [CWE-531](https://cwe.mitre.org/data/definitions/531.html) | Inclusion of Sensitive Information in Test Code | Incomplete | Variant | Distribution; Installation |
| [CWE-532](https://cwe.mitre.org/data/definitions/532.html) | Insertion of Sensitive Information into Log File | Incomplete | Base | Architecture and Design; Distribution; Implementation; Operation |
| [CWE-533](https://cwe.mitre.org/data/definitions/533.html) | DEPRECATED: Information Exposure Through Server Log Files | Deprecated | Variant | — |
| [CWE-534](https://cwe.mitre.org/data/definitions/534.html) | DEPRECATED: Information Exposure Through Debug Log Files | Deprecated | Variant | — |
| [CWE-535](https://cwe.mitre.org/data/definitions/535.html) | Exposure of Information Through Shell Error Message | Incomplete | Variant | — |
| [CWE-536](https://cwe.mitre.org/data/definitions/536.html) | Servlet Runtime Error Message Containing Sensitive Information | Incomplete | Variant | — |
| [CWE-537](https://cwe.mitre.org/data/definitions/537.html) | Java Runtime Error Message Containing Sensitive Information | Incomplete | Variant | Implementation |
| [CWE-538](https://cwe.mitre.org/data/definitions/538.html) | Insertion of Sensitive Information into Externally-Accessible File or Directory | Draft | Base | Architecture and Design; Operation; System Configuration |
| [CWE-539](https://cwe.mitre.org/data/definitions/539.html) | Use of Persistent Cookies Containing Sensitive Information | Incomplete | Variant | Architecture and Design |
| [CWE-540](https://cwe.mitre.org/data/definitions/540.html) | Inclusion of Sensitive Information in Source Code | Incomplete | Base | Architecture and Design; System Configuration |
| [CWE-541](https://cwe.mitre.org/data/definitions/541.html) | Inclusion of Sensitive Information in an Include File | Incomplete | Variant | Architecture and Design; System Configuration |
| [CWE-542](https://cwe.mitre.org/data/definitions/542.html) | DEPRECATED: Information Exposure Through Cleanup Log Files | Deprecated | Variant | — |
| [CWE-543](https://cwe.mitre.org/data/definitions/543.html) | Use of Singleton Pattern Without Synchronization in a Multithreaded Context | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-544](https://cwe.mitre.org/data/definitions/544.html) | Missing Standardized Error Handling Mechanism | Draft | Base | Architecture and Design |
| [CWE-545](https://cwe.mitre.org/data/definitions/545.html) | DEPRECATED: Use of Dynamic Class Loading | Deprecated | Variant | — |
| [CWE-546](https://cwe.mitre.org/data/definitions/546.html) | Suspicious Comment | Draft | Base | Documentation |
| [CWE-547](https://cwe.mitre.org/data/definitions/547.html) | Use of Hard-coded, Security-relevant Constants | Draft | Base | Implementation |
| [CWE-548](https://cwe.mitre.org/data/definitions/548.html) | Exposure of Information Through Directory Listing | Draft | Variant | Architecture and Design; System Configuration |
| [CWE-549](https://cwe.mitre.org/data/definitions/549.html) | Missing Password Field Masking | Draft | Base | Implementation; Requirements |
| [CWE-550](https://cwe.mitre.org/data/definitions/550.html) | Server-generated Error Message Containing Sensitive Information | Incomplete | Variant | Architecture and Design; System Configuration |
| [CWE-551](https://cwe.mitre.org/data/definitions/551.html) | Incorrect Behavior Order: Authorization Before Parsing and Canonicalization | Incomplete | Base | Architecture and Design |
| [CWE-552](https://cwe.mitre.org/data/definitions/552.html) | Files or Directories Accessible to External Parties | Draft | Base | Implementation; Operation; System Configuration |
| [CWE-553](https://cwe.mitre.org/data/definitions/553.html) | Command Shell in Externally Accessible Directory | Incomplete | Variant | Installation; System Configuration |
| [CWE-554](https://cwe.mitre.org/data/definitions/554.html) | ASP.NET Misconfiguration: Not Using Input Validation Framework | Draft | Variant | Architecture and Design |
| [CWE-555](https://cwe.mitre.org/data/definitions/555.html) | J2EE Misconfiguration: Plaintext Password in Configuration File | Draft | Variant | Architecture and Design |
| [CWE-556](https://cwe.mitre.org/data/definitions/556.html) | ASP.NET Misconfiguration: Use of Identity Impersonation | Incomplete | Variant | Architecture and Design |
| [CWE-558](https://cwe.mitre.org/data/definitions/558.html) | Use of getlogin() in Multithreaded Application | Draft | Variant | Architecture and Design; Implementation |
| [CWE-560](https://cwe.mitre.org/data/definitions/560.html) | Use of umask() with chmod-style Argument | Draft | Variant | Implementation |
| [CWE-561](https://cwe.mitre.org/data/definitions/561.html) | Dead Code | Draft | Base | Implementation |
| [CWE-562](https://cwe.mitre.org/data/definitions/562.html) | Return of Stack Variable Address | Draft | Variant | Implementation |
| [CWE-563](https://cwe.mitre.org/data/definitions/563.html) | Assignment to Variable without Use | Draft | Base | Implementation |
| [CWE-564](https://cwe.mitre.org/data/definitions/564.html) | Use of Hibernate with HQL/SQL Query String Containing External Input | Incomplete | Variant | Architecture and Design; Implementation; Requirements |
| [CWE-565](https://cwe.mitre.org/data/definitions/565.html) | Reliance on Cookies without Validation and Integrity Checking | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-566](https://cwe.mitre.org/data/definitions/566.html) | Authorization Bypass Through User-Controlled SQL Primary Key | Incomplete | Variant | Implementation |
| [CWE-567](https://cwe.mitre.org/data/definitions/567.html) | Unsynchronized Access to Shared Data in a Multithreaded Context | Draft | Base | Implementation |
| [CWE-568](https://cwe.mitre.org/data/definitions/568.html) | finalize() Method Without super.finalize() | Draft | Variant | Implementation |
| [CWE-570](https://cwe.mitre.org/data/definitions/570.html) | Expression is Always False | Draft | Base | Implementation |
| [CWE-571](https://cwe.mitre.org/data/definitions/571.html) | Expression is Always True | Draft | Base | Implementation |
| [CWE-572](https://cwe.mitre.org/data/definitions/572.html) | Call to Thread run() instead of start() | Draft | Variant | Implementation |
| [CWE-573](https://cwe.mitre.org/data/definitions/573.html) | Improper Following of Specification by Caller | Draft | Class | Implementation |
| [CWE-574](https://cwe.mitre.org/data/definitions/574.html) | EJB Bad Practices: Use of Synchronization Primitives | Draft | Variant | Implementation |
| [CWE-575](https://cwe.mitre.org/data/definitions/575.html) | EJB Bad Practices: Use of AWT Swing | Draft | Variant | Architecture and Design |
| [CWE-576](https://cwe.mitre.org/data/definitions/576.html) | EJB Bad Practices: Use of Java I/O | Draft | Variant | Implementation |
| [CWE-577](https://cwe.mitre.org/data/definitions/577.html) | EJB Bad Practices: Use of Sockets | Draft | Variant | Architecture and Design; Implementation |
| [CWE-578](https://cwe.mitre.org/data/definitions/578.html) | EJB Bad Practices: Use of Class Loader | Draft | Variant | Architecture and Design; Implementation |
| [CWE-579](https://cwe.mitre.org/data/definitions/579.html) | J2EE Bad Practices: Non-serializable Object Stored in Session | Draft | Variant | Implementation |
| [CWE-580](https://cwe.mitre.org/data/definitions/580.html) | clone() Method Without super.clone() | Draft | Variant | Implementation |
| [CWE-581](https://cwe.mitre.org/data/definitions/581.html) | Object Model Violation: Just One of Equals and Hashcode Defined | Draft | Variant | Implementation |
| [CWE-582](https://cwe.mitre.org/data/definitions/582.html) | Array Declared Public, Final, and Static | Draft | Variant | Implementation |
| [CWE-583](https://cwe.mitre.org/data/definitions/583.html) | finalize() Method Declared Public | Incomplete | Variant | Implementation |
| [CWE-584](https://cwe.mitre.org/data/definitions/584.html) | Return Inside Finally Block | Draft | Base | Implementation |
| [CWE-585](https://cwe.mitre.org/data/definitions/585.html) | Empty Synchronized Block | Draft | Variant | Implementation |
| [CWE-586](https://cwe.mitre.org/data/definitions/586.html) | Explicit Call to Finalize() | Draft | Base | Implementation |
| [CWE-587](https://cwe.mitre.org/data/definitions/587.html) | Assignment of a Fixed Address to a Pointer | Draft | Variant | Implementation |
| [CWE-588](https://cwe.mitre.org/data/definitions/588.html) | Attempt to Access Child of a Non-structure Pointer | Incomplete | Variant | Implementation; Requirements |
| [CWE-589](https://cwe.mitre.org/data/definitions/589.html) | Call to Non-ubiquitous API | Incomplete | Variant | Implementation; Testing |
| [CWE-590](https://cwe.mitre.org/data/definitions/590.html) | Free of Memory not on the Heap | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-591](https://cwe.mitre.org/data/definitions/591.html) | Sensitive Data Storage in Improperly Locked Memory | Draft | Variant | Architecture and Design; Implementation |
| [CWE-592](https://cwe.mitre.org/data/definitions/592.html) | DEPRECATED: Authentication Bypass Issues | Deprecated | Class | — |
| [CWE-593](https://cwe.mitre.org/data/definitions/593.html) | Authentication Bypass: OpenSSL CTX Object Modified after SSL Objects are Created | Draft | Variant | Architecture and Design; Implementation |
| [CWE-594](https://cwe.mitre.org/data/definitions/594.html) | J2EE Framework: Saving Unserializable Objects to Disk | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-595](https://cwe.mitre.org/data/definitions/595.html) | Comparison of Object References Instead of Object Contents | Incomplete | Variant | Implementation |
| [CWE-596](https://cwe.mitre.org/data/definitions/596.html) | DEPRECATED: Incorrect Semantic Object Comparison | Deprecated | Base | — |
| [CWE-597](https://cwe.mitre.org/data/definitions/597.html) | Use of Wrong Operator in String Comparison | Draft | Variant | Implementation |
| [CWE-598](https://cwe.mitre.org/data/definitions/598.html) | Use of HTTP Request With Sensitive Query String | Draft | Variant | Implementation |
| [CWE-599](https://cwe.mitre.org/data/definitions/599.html) | Missing Validation of OpenSSL Certificate | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-600](https://cwe.mitre.org/data/definitions/600.html) | Uncaught Exception in Servlet | Draft | Variant | Implementation |
| [CWE-601](https://cwe.mitre.org/data/definitions/601.html) | URL Redirection to Untrusted Site | Draft | Base | Architecture and Design; Implementation; Operation |
| [CWE-602](https://cwe.mitre.org/data/definitions/602.html) | Client-Side Enforcement of Server-Side Security | Draft | Class | Architecture and Design |
| [CWE-603](https://cwe.mitre.org/data/definitions/603.html) | Use of Client-Side Authentication | Draft | Base | Architecture and Design |
| [CWE-605](https://cwe.mitre.org/data/definitions/605.html) | Multiple Binds to the Same Port | Draft | Variant | Policy |
| [CWE-606](https://cwe.mitre.org/data/definitions/606.html) | Unchecked Input for Loop Condition | Draft | Base | Implementation |
| [CWE-607](https://cwe.mitre.org/data/definitions/607.html) | Public Static Final Field References Mutable Object | Draft | Variant | Implementation |
| [CWE-608](https://cwe.mitre.org/data/definitions/608.html) | Struts: Non-private Field in ActionForm Class | Draft | Variant | Implementation |
| [CWE-609](https://cwe.mitre.org/data/definitions/609.html) | Double-Checked Locking | Draft | Base | Implementation |
| [CWE-610](https://cwe.mitre.org/data/definitions/610.html) | Externally Controlled Reference to a Resource in Another Sphere | Draft | Class | — |
| [CWE-611](https://cwe.mitre.org/data/definitions/611.html) | Improper Restriction of XML External Entity Reference | Draft | Base | Implementation; System Configuration |
| [CWE-612](https://cwe.mitre.org/data/definitions/612.html) | Improper Authorization of Index Containing Sensitive Information | Draft | Base | — |
| [CWE-613](https://cwe.mitre.org/data/definitions/613.html) | DEPRECATED: Insufficient Session Expiration | Deprecated | Base | — |
| [CWE-614](https://cwe.mitre.org/data/definitions/614.html) | Sensitive Cookie in HTTPS Session Without 'Secure' Attribute | Draft | Variant | Implementation |
| [CWE-615](https://cwe.mitre.org/data/definitions/615.html) | Inclusion of Sensitive Information in Source Code Comments | Incomplete | Variant | Distribution |
| [CWE-616](https://cwe.mitre.org/data/definitions/616.html) | Incomplete Identification of Uploaded File Variables (PHP) | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-617](https://cwe.mitre.org/data/definitions/617.html) | Reachable Assertion | Draft | Base | Implementation |
| [CWE-618](https://cwe.mitre.org/data/definitions/618.html) | Exposed Unsafe ActiveX Method | Incomplete | Variant | Architecture and Design; Implementation; System Configuration |
| [CWE-619](https://cwe.mitre.org/data/definitions/619.html) | Dangling Database Cursor | Incomplete | Base | Implementation |
| [CWE-620](https://cwe.mitre.org/data/definitions/620.html) | Unverified Password Change | Draft | Base | Architecture and Design |
| [CWE-621](https://cwe.mitre.org/data/definitions/621.html) | Variable Extraction Error | Incomplete | Variant | Implementation |
| [CWE-622](https://cwe.mitre.org/data/definitions/622.html) | Improper Validation of Function Hook Arguments | Draft | Variant | Architecture and Design |
| [CWE-623](https://cwe.mitre.org/data/definitions/623.html) | Unsafe ActiveX Control Marked Safe For Scripting | Draft | Variant | Architecture and Design; System Configuration |
| [CWE-624](https://cwe.mitre.org/data/definitions/624.html) | Executable Regular Expression Error | Incomplete | Base | Implementation |
| [CWE-625](https://cwe.mitre.org/data/definitions/625.html) | Permissive Regular Expression | Draft | Base | Implementation |
| [CWE-626](https://cwe.mitre.org/data/definitions/626.html) | Null Byte Interaction Error (Poison Null Byte) | Draft | Variant | Implementation |
| [CWE-627](https://cwe.mitre.org/data/definitions/627.html) | Dynamic Variable Evaluation | Incomplete | Variant | Implementation |
| [CWE-628](https://cwe.mitre.org/data/definitions/628.html) | Function Call with Incorrectly Specified Arguments | Draft | Base | Architecture and Design; Build and Compilation |
| [CWE-636](https://cwe.mitre.org/data/definitions/636.html) | Not Failing Securely | Draft | Class | Architecture and Design |
| [CWE-637](https://cwe.mitre.org/data/definitions/637.html) | Unnecessary Complexity in Protection Mechanism (Not Using 'Economy of Mechanism') | Draft | Class | Architecture and Design; Requirements |
| [CWE-638](https://cwe.mitre.org/data/definitions/638.html) | Not Using Complete Mediation | Draft | Class | Architecture and Design |
| [CWE-639](https://cwe.mitre.org/data/definitions/639.html) | Authorization Bypass Through User-Controlled Key | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-640](https://cwe.mitre.org/data/definitions/640.html) | Weak Password Recovery Mechanism for Forgotten Password | Incomplete | Base | Architecture and Design |
| [CWE-641](https://cwe.mitre.org/data/definitions/641.html) | Improper Restriction of Names for Files and Other Resources | Incomplete | Base | Architecture and Design |
| [CWE-642](https://cwe.mitre.org/data/definitions/642.html) | External Control of Critical State Data | Draft | Class | Architecture and Design; Implementation; Operation |
| [CWE-643](https://cwe.mitre.org/data/definitions/643.html) | Improper Neutralization of Data within XPath Expressions | Incomplete | Base | Implementation |
| [CWE-644](https://cwe.mitre.org/data/definitions/644.html) | Improper Neutralization of HTTP Headers for Scripting Syntax | Incomplete | Variant | Architecture and Design |
| [CWE-645](https://cwe.mitre.org/data/definitions/645.html) | Overly Restrictive Account Lockout Mechanism | Incomplete | Base | Architecture and Design |
| [CWE-646](https://cwe.mitre.org/data/definitions/646.html) | Reliance on File Name or Extension of Externally-Supplied File | Incomplete | Base | Architecture and Design |
| [CWE-647](https://cwe.mitre.org/data/definitions/647.html) | Use of Non-Canonical URL Paths for Authorization Decisions | Incomplete | Variant | Architecture and Design |
| [CWE-648](https://cwe.mitre.org/data/definitions/648.html) | Incorrect Use of Privileged APIs | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-649](https://cwe.mitre.org/data/definitions/649.html) | Reliance on Obfuscation or Encryption of Security-Relevant Inputs without Integrity Checking | Incomplete | Base | Architecture and Design |
| [CWE-650](https://cwe.mitre.org/data/definitions/650.html) | Trusting HTTP Permission Methods on the Server Side | Incomplete | Variant | Architecture and Design; Implementation; System Configuration |
| [CWE-651](https://cwe.mitre.org/data/definitions/651.html) | Exposure of WSDL File Containing Sensitive Information | Incomplete | Variant | Architecture and Design |
| [CWE-652](https://cwe.mitre.org/data/definitions/652.html) | Improper Neutralization of Data within XQuery Expressions | Incomplete | Base | Implementation |
| [CWE-653](https://cwe.mitre.org/data/definitions/653.html) | Improper Isolation or Compartmentalization | Draft | Class | Architecture and Design |
| [CWE-654](https://cwe.mitre.org/data/definitions/654.html) | Reliance on a Single Factor in a Security Decision | Draft | Base | Architecture and Design |
| [CWE-655](https://cwe.mitre.org/data/definitions/655.html) | Insufficient Psychological Acceptability | Draft | Class | Architecture and Design; Testing |
| [CWE-656](https://cwe.mitre.org/data/definitions/656.html) | Reliance on Security Through Obscurity | Draft | Class | Architecture and Design |
| [CWE-657](https://cwe.mitre.org/data/definitions/657.html) | Violation of Secure Design Principles | Draft | Class | — |
| [CWE-662](https://cwe.mitre.org/data/definitions/662.html) | Improper Synchronization | Draft | Class | Implementation |
| [CWE-663](https://cwe.mitre.org/data/definitions/663.html) | Use of a Non-reentrant Function in a Concurrent Context | Draft | Base | Implementation |
| [CWE-664](https://cwe.mitre.org/data/definitions/664.html) | Improper Control of a Resource Through its Lifetime | Draft | Pillar | — |
| [CWE-665](https://cwe.mitre.org/data/definitions/665.html) | Improper Initialization | Draft | Class | Architecture and Design; Build and Compilation; Implementation; Requirements |
| [CWE-666](https://cwe.mitre.org/data/definitions/666.html) | Operation on Resource in Wrong Phase of Lifetime | Draft | Class | Architecture and Design; Implementation |
| [CWE-667](https://cwe.mitre.org/data/definitions/667.html) | Improper Locking | Draft | Class | Implementation |
| [CWE-668](https://cwe.mitre.org/data/definitions/668.html) | Exposure of Resource to Wrong Sphere | Draft | Class | — |
| [CWE-669](https://cwe.mitre.org/data/definitions/669.html) | Incorrect Resource Transfer Between Spheres | Draft | Class | — |
| [CWE-670](https://cwe.mitre.org/data/definitions/670.html) | Always-Incorrect Control Flow Implementation | Draft | Class | — |
| [CWE-671](https://cwe.mitre.org/data/definitions/671.html) | Lack of Administrator Control over Security | Draft | Class | — |
| [CWE-672](https://cwe.mitre.org/data/definitions/672.html) | Operation on a Resource after Expiration or Release | Draft | Class | — |
| [CWE-673](https://cwe.mitre.org/data/definitions/673.html) | External Influence of Sphere Definition | Draft | Class | — |
| [CWE-674](https://cwe.mitre.org/data/definitions/674.html) | Uncontrolled Recursion | Draft | Class | Implementation |
| [CWE-675](https://cwe.mitre.org/data/definitions/675.html) | Multiple Operations on Resource in Single-Operation Context | Draft | Class | — |
| [CWE-676](https://cwe.mitre.org/data/definitions/676.html) | Use of Potentially Dangerous Function | Draft | Base | Build and Compilation; Implementation |
| [CWE-680](https://cwe.mitre.org/data/definitions/680.html) | Integer Overflow to Buffer Overflow | Draft | Compound | — |
| [CWE-681](https://cwe.mitre.org/data/definitions/681.html) | Incorrect Conversion between Numeric Types | Draft | Base | Implementation |
| [CWE-682](https://cwe.mitre.org/data/definitions/682.html) | Incorrect Calculation | Draft | Pillar | Architecture and Design; Implementation |
| [CWE-683](https://cwe.mitre.org/data/definitions/683.html) | Function Call With Incorrect Order of Arguments | Draft | Variant | Implementation |
| [CWE-684](https://cwe.mitre.org/data/definitions/684.html) | Incorrect Provision of Specified Functionality | Draft | Class | Implementation |
| [CWE-685](https://cwe.mitre.org/data/definitions/685.html) | Function Call With Incorrect Number of Arguments | Draft | Variant | Testing |
| [CWE-686](https://cwe.mitre.org/data/definitions/686.html) | Function Call With Incorrect Argument Type | Draft | Variant | — |
| [CWE-687](https://cwe.mitre.org/data/definitions/687.html) | Function Call With Incorrectly Specified Argument Value | Draft | Variant | — |
| [CWE-688](https://cwe.mitre.org/data/definitions/688.html) | Function Call With Incorrect Variable or Reference as Argument | Draft | Variant | Testing |
| [CWE-689](https://cwe.mitre.org/data/definitions/689.html) | Permission Race Condition During Resource Copy | Draft | Compound | — |
| [CWE-690](https://cwe.mitre.org/data/definitions/690.html) | Unchecked Return Value to NULL Pointer Dereference | Draft | Compound | — |
| [CWE-691](https://cwe.mitre.org/data/definitions/691.html) | Insufficient Control Flow Management | Draft | Pillar | — |
| [CWE-692](https://cwe.mitre.org/data/definitions/692.html) | Incomplete Denylist to Cross-Site Scripting | Draft | Compound | — |
| [CWE-693](https://cwe.mitre.org/data/definitions/693.html) | Protection Mechanism Failure | Draft | Pillar | — |
| [CWE-694](https://cwe.mitre.org/data/definitions/694.html) | Use of Multiple Resources with Duplicate Identifier | Incomplete | Base | Architecture and Design |
| [CWE-695](https://cwe.mitre.org/data/definitions/695.html) | Use of Low-Level Functionality | Incomplete | Base | — |
| [CWE-696](https://cwe.mitre.org/data/definitions/696.html) | Incorrect Behavior Order | Incomplete | Class | — |
| [CWE-697](https://cwe.mitre.org/data/definitions/697.html) | Incorrect Comparison | Incomplete | Pillar | — |
| [CWE-698](https://cwe.mitre.org/data/definitions/698.html) | Execution After Redirect (EAR) | Incomplete | Base | — |
| [CWE-703](https://cwe.mitre.org/data/definitions/703.html) | Improper Check or Handling of Exceptional Conditions | Incomplete | Pillar | — |
| [CWE-704](https://cwe.mitre.org/data/definitions/704.html) | Incorrect Type Conversion or Cast | Incomplete | Class | — |
| [CWE-705](https://cwe.mitre.org/data/definitions/705.html) | Incorrect Control Flow Scoping | Incomplete | Class | — |
| [CWE-706](https://cwe.mitre.org/data/definitions/706.html) | Use of Incorrectly-Resolved Name or Reference | Incomplete | Class | — |
| [CWE-707](https://cwe.mitre.org/data/definitions/707.html) | Improper Neutralization | Incomplete | Pillar | — |
| [CWE-708](https://cwe.mitre.org/data/definitions/708.html) | Incorrect Ownership Assignment | Incomplete | Base | Policy |
| [CWE-710](https://cwe.mitre.org/data/definitions/710.html) | Improper Adherence to Coding Standards | Incomplete | Pillar | Implementation; Policy |
| [CWE-732](https://cwe.mitre.org/data/definitions/732.html) | Incorrect Permission Assignment for Critical Resource | Draft | Class | Architecture and Design; Documentation; Implementation; Installation; Operation; System Configuration |
| [CWE-733](https://cwe.mitre.org/data/definitions/733.html) | Compiler Optimization Removal or Modification of Security-critical Code | Incomplete | Base | — |
| [CWE-749](https://cwe.mitre.org/data/definitions/749.html) | Exposed Dangerous Method or Function | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-754](https://cwe.mitre.org/data/definitions/754.html) | Improper Check for Unusual or Exceptional Conditions | Incomplete | Class | Architecture and Design; Implementation; Requirements |
| [CWE-755](https://cwe.mitre.org/data/definitions/755.html) | Improper Handling of Exceptional Conditions | Incomplete | Class | — |
| [CWE-756](https://cwe.mitre.org/data/definitions/756.html) | Missing Custom Error Page | Incomplete | Base | — |
| [CWE-757](https://cwe.mitre.org/data/definitions/757.html) | Selection of Less-Secure Algorithm During Negotiation | Incomplete | Class | — |
| [CWE-758](https://cwe.mitre.org/data/definitions/758.html) | Reliance on Undefined, Unspecified, or Implementation-Defined Behavior | Incomplete | Class | — |
| [CWE-759](https://cwe.mitre.org/data/definitions/759.html) | Use of a One-Way Hash without a Salt | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-760](https://cwe.mitre.org/data/definitions/760.html) | Use of a One-Way Hash with a Predictable Salt | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-761](https://cwe.mitre.org/data/definitions/761.html) | Free of Pointer not at Start of Buffer | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-762](https://cwe.mitre.org/data/definitions/762.html) | Mismatched Memory Management Routines | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-763](https://cwe.mitre.org/data/definitions/763.html) | Release of Invalid Pointer or Reference | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-764](https://cwe.mitre.org/data/definitions/764.html) | Multiple Locks of a Critical Resource | Incomplete | Base | Implementation |
| [CWE-765](https://cwe.mitre.org/data/definitions/765.html) | Multiple Unlocks of a Critical Resource | Incomplete | Base | Implementation |
| [CWE-766](https://cwe.mitre.org/data/definitions/766.html) | Critical Data Element Declared Public | Incomplete | Base | Implementation |
| [CWE-767](https://cwe.mitre.org/data/definitions/767.html) | Access to Critical Private Variable via Public Method | Incomplete | Variant | Implementation |
| [CWE-768](https://cwe.mitre.org/data/definitions/768.html) | Incorrect Short Circuit Evaluation | Incomplete | Base | Implementation |
| [CWE-769](https://cwe.mitre.org/data/definitions/769.html) | DEPRECATED: Uncontrolled File Descriptor Consumption | Deprecated | Base | — |
| [CWE-770](https://cwe.mitre.org/data/definitions/770.html) | Allocation of Resources Without Limits or Throttling | Incomplete | Base | Architecture and Design; Implementation; Operation; Requirements |
| [CWE-771](https://cwe.mitre.org/data/definitions/771.html) | Missing Reference to Active Allocated Resource | Incomplete | Base | Architecture and Design; Operation |
| [CWE-772](https://cwe.mitre.org/data/definitions/772.html) | Missing Release of Resource after Effective Lifetime | Draft | Base | Architecture and Design; Implementation; Operation; Requirements |
| [CWE-773](https://cwe.mitre.org/data/definitions/773.html) | Missing Reference to Active File Descriptor or Handle | Incomplete | Variant | Architecture and Design; Operation |
| [CWE-774](https://cwe.mitre.org/data/definitions/774.html) | Allocation of File Descriptors or Handles Without Limits or Throttling | Incomplete | Variant | Architecture and Design; Operation |
| [CWE-775](https://cwe.mitre.org/data/definitions/775.html) | Missing Release of File Descriptor or Handle after Effective Lifetime | Incomplete | Variant | Architecture and Design; Operation |
| [CWE-776](https://cwe.mitre.org/data/definitions/776.html) | Improper Restriction of Recursive Entity References in DTDs | Draft | Base | Implementation; Operation |
| [CWE-777](https://cwe.mitre.org/data/definitions/777.html) | Regular Expression without Anchors | Incomplete | Variant | Implementation |
| [CWE-778](https://cwe.mitre.org/data/definitions/778.html) | Insufficient Logging | Draft | Base | Architecture and Design; Implementation; Operation |
| [CWE-779](https://cwe.mitre.org/data/definitions/779.html) | Logging of Excessive Data | Draft | Base | Architecture and Design; Implementation |
| [CWE-780](https://cwe.mitre.org/data/definitions/780.html) | Use of RSA Algorithm without OAEP | Incomplete | Variant | — |
| [CWE-781](https://cwe.mitre.org/data/definitions/781.html) | Improper Address Validation in IOCTL with METHOD_NEITHER I/O Control Code | Draft | Variant | Architecture and Design; Implementation |
| [CWE-782](https://cwe.mitre.org/data/definitions/782.html) | Exposed IOCTL with Insufficient Access Control | Draft | Variant | Architecture and Design |
| [CWE-783](https://cwe.mitre.org/data/definitions/783.html) | Operator Precedence Logic Error | Draft | Base | Implementation |
| [CWE-784](https://cwe.mitre.org/data/definitions/784.html) | Reliance on Cookies without Validation and Integrity Checking in a Security Decision | Draft | Variant | Architecture and Design; Implementation |
| [CWE-785](https://cwe.mitre.org/data/definitions/785.html) | Use of Path Manipulation Function without Maximum-sized Buffer | Incomplete | Variant | Implementation |
| [CWE-786](https://cwe.mitre.org/data/definitions/786.html) | Access of Memory Location Before Start of Buffer | Incomplete | Base | — |
| [CWE-787](https://cwe.mitre.org/data/definitions/787.html) | Out-of-bounds Write | Draft | Base | Architecture and Design; Build and Compilation; Implementation; Operation; Requirements |
| [CWE-788](https://cwe.mitre.org/data/definitions/788.html) | Access of Memory Location After End of Buffer | Incomplete | Base | — |
| [CWE-789](https://cwe.mitre.org/data/definitions/789.html) | Memory Allocation with Excessive Size Value | Draft | Variant | Architecture and Design; Implementation; Operation |
| [CWE-790](https://cwe.mitre.org/data/definitions/790.html) | Improper Filtering of Special Elements | Incomplete | Class | — |
| [CWE-791](https://cwe.mitre.org/data/definitions/791.html) | Incomplete Filtering of Special Elements | Incomplete | Base | — |
| [CWE-792](https://cwe.mitre.org/data/definitions/792.html) | Incomplete Filtering of One or More Instances of Special Elements | Incomplete | Variant | — |
| [CWE-793](https://cwe.mitre.org/data/definitions/793.html) | Only Filtering One Instance of a Special Element | Incomplete | Variant | — |
| [CWE-794](https://cwe.mitre.org/data/definitions/794.html) | Incomplete Filtering of Multiple Instances of Special Elements | Incomplete | Variant | — |
| [CWE-795](https://cwe.mitre.org/data/definitions/795.html) | Only Filtering Special Elements at a Specified Location | Incomplete | Base | — |
| [CWE-796](https://cwe.mitre.org/data/definitions/796.html) | Only Filtering Special Elements Relative to a Marker | Incomplete | Variant | — |
| [CWE-797](https://cwe.mitre.org/data/definitions/797.html) | Only Filtering Special Elements at an Absolute Position | Incomplete | Variant | — |
| [CWE-798](https://cwe.mitre.org/data/definitions/798.html) | Use of Hard-coded Credentials | Draft | Base | Architecture and Design |
| [CWE-799](https://cwe.mitre.org/data/definitions/799.html) | Improper Control of Interaction Frequency | Incomplete | Class | — |
| [CWE-804](https://cwe.mitre.org/data/definitions/804.html) | Guessable CAPTCHA | Incomplete | Base | — |
| [CWE-805](https://cwe.mitre.org/data/definitions/805.html) | Buffer Access with Incorrect Length Value | Incomplete | Base | Architecture and Design; Build and Compilation; Implementation; Operation; Requirements |
| [CWE-806](https://cwe.mitre.org/data/definitions/806.html) | Buffer Access Using Size of Source Buffer | Incomplete | Variant | Architecture and Design; Build and Compilation; Implementation; Operation |
| [CWE-807](https://cwe.mitre.org/data/definitions/807.html) | Reliance on Untrusted Inputs in a Security Decision | Incomplete | Base | Architecture and Design; Implementation; Operation |
| [CWE-820](https://cwe.mitre.org/data/definitions/820.html) | Missing Synchronization | Incomplete | Base | — |
| [CWE-821](https://cwe.mitre.org/data/definitions/821.html) | Incorrect Synchronization | Incomplete | Base | — |
| [CWE-822](https://cwe.mitre.org/data/definitions/822.html) | Untrusted Pointer Dereference | Incomplete | Base | — |
| [CWE-823](https://cwe.mitre.org/data/definitions/823.html) | Use of Out-of-range Pointer Offset | Incomplete | Base | — |
| [CWE-824](https://cwe.mitre.org/data/definitions/824.html) | Access of Uninitialized Pointer | Incomplete | Base | — |
| [CWE-825](https://cwe.mitre.org/data/definitions/825.html) | Expired Pointer Dereference | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-826](https://cwe.mitre.org/data/definitions/826.html) | Premature Release of Resource During Expected Lifetime | Incomplete | Base | — |
| [CWE-827](https://cwe.mitre.org/data/definitions/827.html) | Improper Control of Document Type Definition | Incomplete | Variant | — |
| [CWE-828](https://cwe.mitre.org/data/definitions/828.html) | Signal Handler with Functionality that is not Asynchronous-Safe | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-829](https://cwe.mitre.org/data/definitions/829.html) | Inclusion of Functionality from Untrusted Control Sphere | Incomplete | Base | Architecture and Design; Implementation; Operation |
| [CWE-830](https://cwe.mitre.org/data/definitions/830.html) | Inclusion of Web Functionality from an Untrusted Source | Incomplete | Variant | — |
| [CWE-831](https://cwe.mitre.org/data/definitions/831.html) | Signal Handler Function Associated with Multiple Signals | Incomplete | Variant | — |
| [CWE-832](https://cwe.mitre.org/data/definitions/832.html) | Unlock of a Resource that is not Locked | Incomplete | Base | — |
| [CWE-833](https://cwe.mitre.org/data/definitions/833.html) | Deadlock | Incomplete | Base | — |
| [CWE-834](https://cwe.mitre.org/data/definitions/834.html) | Excessive Iteration | Incomplete | Class | — |
| [CWE-835](https://cwe.mitre.org/data/definitions/835.html) | Loop with Unreachable Exit Condition | Incomplete | Base | — |
| [CWE-836](https://cwe.mitre.org/data/definitions/836.html) | Use of Password Hash Instead of Password for Authentication | Incomplete | Base | — |
| [CWE-837](https://cwe.mitre.org/data/definitions/837.html) | Improper Enforcement of a Single, Unique Action | Incomplete | Base | — |
| [CWE-838](https://cwe.mitre.org/data/definitions/838.html) | Inappropriate Encoding for Output Context | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-839](https://cwe.mitre.org/data/definitions/839.html) | Numeric Range Comparison Without Minimum Check | Incomplete | Base | Implementation |
| [CWE-841](https://cwe.mitre.org/data/definitions/841.html) | Improper Enforcement of Behavioral Workflow | Incomplete | Class | — |
| [CWE-842](https://cwe.mitre.org/data/definitions/842.html) | Placement of User into Incorrect Group | Incomplete | Base | — |
| [CWE-843](https://cwe.mitre.org/data/definitions/843.html) | Access of Resource Using Incompatible Type | Incomplete | Base | — |
| [CWE-862](https://cwe.mitre.org/data/definitions/862.html) | Missing Authorization | Incomplete | Class | Architecture and Design; Installation; System Configuration |
| [CWE-863](https://cwe.mitre.org/data/definitions/863.html) | Incorrect Authorization | Incomplete | Class | Architecture and Design; Installation; System Configuration |
| [CWE-908](https://cwe.mitre.org/data/definitions/908.html) | Use of Uninitialized Resource | Incomplete | Base | Build and Compilation; Implementation |
| [CWE-909](https://cwe.mitre.org/data/definitions/909.html) | Missing Initialization of Resource | Incomplete | Class | Build and Compilation; Implementation |
| [CWE-910](https://cwe.mitre.org/data/definitions/910.html) | Use of Expired File Descriptor | Incomplete | Base | — |
| [CWE-911](https://cwe.mitre.org/data/definitions/911.html) | Improper Update of Reference Count | Incomplete | Base | — |
| [CWE-912](https://cwe.mitre.org/data/definitions/912.html) | Hidden Functionality | Incomplete | Class | Installation |
| [CWE-913](https://cwe.mitre.org/data/definitions/913.html) | Improper Control of Dynamically-Managed Code Resources | Incomplete | Class | Architecture and Design; Implementation |
| [CWE-914](https://cwe.mitre.org/data/definitions/914.html) | Improper Control of Dynamically-Identified Variables | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-915](https://cwe.mitre.org/data/definitions/915.html) | Improperly Controlled Modification of Dynamically-Determined Object Attributes | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-916](https://cwe.mitre.org/data/definitions/916.html) | Use of Password Hash With Insufficient Computational Effort | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-917](https://cwe.mitre.org/data/definitions/917.html) | Improper Neutralization of Special Elements used in an Expression Language Statement | Incomplete | Base | Architecture and Design; Implementation; Operation; System Configuration |
| [CWE-918](https://cwe.mitre.org/data/definitions/918.html) | Server-Side Request Forgery | Incomplete | Base | Implementation; Operation |
| [CWE-920](https://cwe.mitre.org/data/definitions/920.html) | Improper Restriction of Power Consumption | Incomplete | Base | — |
| [CWE-921](https://cwe.mitre.org/data/definitions/921.html) | Storage of Sensitive Data in a Mechanism without Access Control | Incomplete | Base | — |
| [CWE-922](https://cwe.mitre.org/data/definitions/922.html) | Insecure Storage of Sensitive Information | Incomplete | Class | — |
| [CWE-923](https://cwe.mitre.org/data/definitions/923.html) | Improper Restriction of Communication Channel to Intended Endpoints | Incomplete | Class | — |
| [CWE-924](https://cwe.mitre.org/data/definitions/924.html) | Improper Enforcement of Message Integrity During Transmission in a Communication Channel | Incomplete | Base | — |
| [CWE-925](https://cwe.mitre.org/data/definitions/925.html) | Improper Verification of Intent by Broadcast Receiver | Incomplete | Variant | Architecture and Design |
| [CWE-926](https://cwe.mitre.org/data/definitions/926.html) | Improper Export of Android Application Components | Incomplete | Variant | Architecture and Design; Build and Compilation |
| [CWE-927](https://cwe.mitre.org/data/definitions/927.html) | Use of Implicit Intent for Sensitive Communication | Incomplete | Variant | Implementation |
| [CWE-939](https://cwe.mitre.org/data/definitions/939.html) | Improper Authorization in Handler for Custom URL Scheme | Incomplete | Base | Architecture and Design |
| [CWE-940](https://cwe.mitre.org/data/definitions/940.html) | Improper Verification of Source of a Communication Channel | Incomplete | Base | Architecture and Design |
| [CWE-941](https://cwe.mitre.org/data/definitions/941.html) | Incorrectly Specified Destination in a Communication Channel | Incomplete | Base | — |
| [CWE-942](https://cwe.mitre.org/data/definitions/942.html) | Permissive Cross-domain Security Policy with Untrusted Domains | Incomplete | Variant | Architecture and Design; Operation |
| [CWE-943](https://cwe.mitre.org/data/definitions/943.html) | Improper Neutralization of Special Elements in Data Query Logic | Incomplete | Class | — |
| [CWE-1004](https://cwe.mitre.org/data/definitions/1004.html) | Sensitive Cookie Without 'HttpOnly' Flag | Incomplete | Variant | Implementation |
| [CWE-1007](https://cwe.mitre.org/data/definitions/1007.html) | Insufficient Visual Distinction of Homoglyphs Presented to User | Incomplete | Base | Implementation |
| [CWE-1021](https://cwe.mitre.org/data/definitions/1021.html) | Improper Restriction of Rendered UI Layers or Frames | Incomplete | Base | Implementation |
| [CWE-1022](https://cwe.mitre.org/data/definitions/1022.html) | Use of Web Link to Untrusted Target with window.opener Access | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-1023](https://cwe.mitre.org/data/definitions/1023.html) | Incomplete Comparison with Missing Factors | Incomplete | Class | — |
| [CWE-1024](https://cwe.mitre.org/data/definitions/1024.html) | Comparison of Incompatible Types | Incomplete | Class | — |
| [CWE-1025](https://cwe.mitre.org/data/definitions/1025.html) | Comparison Using Wrong Factors | Incomplete | Class | — |
| [CWE-1037](https://cwe.mitre.org/data/definitions/1037.html) | Processor Optimization Removal or Modification of Security-critical Code | Incomplete | Base | — |
| [CWE-1038](https://cwe.mitre.org/data/definitions/1038.html) | Insecure Automated Optimizations | Draft | Class | — |
| [CWE-1039](https://cwe.mitre.org/data/definitions/1039.html) | Inadequate Detection or Handling of Adversarial Input Perturbations in Automated Recognition Mechanism | Incomplete | Class | Architecture and Design; Implementation; Integration; Training |
| [CWE-1041](https://cwe.mitre.org/data/definitions/1041.html) | Use of Redundant Code | Incomplete | Class | Implementation |
| [CWE-1042](https://cwe.mitre.org/data/definitions/1042.html) | Static Member Data Element outside of a Singleton Class Element | Incomplete | Variant | — |
| [CWE-1043](https://cwe.mitre.org/data/definitions/1043.html) | Data Element Aggregating an Excessively Large Number of Non-Primitive Elements | Incomplete | Base | — |
| [CWE-1044](https://cwe.mitre.org/data/definitions/1044.html) | Architecture with Number of Horizontal Layers Outside of Expected Range | Incomplete | Base | — |
| [CWE-1045](https://cwe.mitre.org/data/definitions/1045.html) | Parent Class with a Virtual Destructor and a Child Class without a Virtual Destructor | Incomplete | Base | — |
| [CWE-1046](https://cwe.mitre.org/data/definitions/1046.html) | Creation of Immutable Text Using String Concatenation | Incomplete | Base | — |
| [CWE-1047](https://cwe.mitre.org/data/definitions/1047.html) | Modules with Circular Dependencies | Incomplete | Base | — |
| [CWE-1048](https://cwe.mitre.org/data/definitions/1048.html) | Invokable Control Element with Large Number of Outward Calls | Incomplete | Base | — |
| [CWE-1049](https://cwe.mitre.org/data/definitions/1049.html) | Excessive Data Query Operations in a Large Data Table | Incomplete | Base | — |
| [CWE-1050](https://cwe.mitre.org/data/definitions/1050.html) | Excessive Platform Resource Consumption within a Loop | Incomplete | Base | — |
| [CWE-1051](https://cwe.mitre.org/data/definitions/1051.html) | Initialization with Hard-Coded Network Resource Configuration Data | Incomplete | Base | — |
| [CWE-1052](https://cwe.mitre.org/data/definitions/1052.html) | Excessive Use of Hard-Coded Literals in Initialization | Incomplete | Base | — |
| [CWE-1053](https://cwe.mitre.org/data/definitions/1053.html) | Missing Documentation for Design | Incomplete | Base | — |
| [CWE-1054](https://cwe.mitre.org/data/definitions/1054.html) | Invocation of a Control Element at an Unnecessarily Deep Horizontal Layer | Incomplete | Base | — |
| [CWE-1055](https://cwe.mitre.org/data/definitions/1055.html) | Multiple Inheritance from Concrete Classes | Incomplete | Base | — |
| [CWE-1056](https://cwe.mitre.org/data/definitions/1056.html) | Invokable Control Element with Variadic Parameters | Incomplete | Base | — |
| [CWE-1057](https://cwe.mitre.org/data/definitions/1057.html) | Data Access Operations Outside of Expected Data Manager Component | Incomplete | Base | — |
| [CWE-1058](https://cwe.mitre.org/data/definitions/1058.html) | Invokable Control Element in Multi-Thread Context with non-Final Static Storable or Member Element | Incomplete | Base | — |
| [CWE-1059](https://cwe.mitre.org/data/definitions/1059.html) | Insufficient Technical Documentation | Incomplete | Class | Architecture and Design; Documentation |
| [CWE-1060](https://cwe.mitre.org/data/definitions/1060.html) | Excessive Number of Inefficient Server-Side Data Accesses | Incomplete | Base | — |
| [CWE-1061](https://cwe.mitre.org/data/definitions/1061.html) | Insufficient Encapsulation | Incomplete | Class | — |
| [CWE-1062](https://cwe.mitre.org/data/definitions/1062.html) | Parent Class with References to Child Class | Incomplete | Base | — |
| [CWE-1063](https://cwe.mitre.org/data/definitions/1063.html) | Creation of Class Instance within a Static Code Block | Incomplete | Base | — |
| [CWE-1064](https://cwe.mitre.org/data/definitions/1064.html) | Invokable Control Element with Signature Containing an Excessive Number of Parameters | Incomplete | Base | — |
| [CWE-1065](https://cwe.mitre.org/data/definitions/1065.html) | Runtime Resource Management Control Element in a Component Built to Run on Application Servers | Incomplete | Base | — |
| [CWE-1066](https://cwe.mitre.org/data/definitions/1066.html) | Missing Serialization Control Element | Incomplete | Base | — |
| [CWE-1067](https://cwe.mitre.org/data/definitions/1067.html) | Excessive Execution of Sequential Searches of Data Resource | Incomplete | Base | — |
| [CWE-1068](https://cwe.mitre.org/data/definitions/1068.html) | Inconsistency Between Implementation and Documented Design | Incomplete | Class | — |
| [CWE-1069](https://cwe.mitre.org/data/definitions/1069.html) | Empty Exception Block | Incomplete | Variant | Implementation |
| [CWE-1070](https://cwe.mitre.org/data/definitions/1070.html) | Serializable Data Element Containing non-Serializable Item Elements | Incomplete | Base | — |
| [CWE-1071](https://cwe.mitre.org/data/definitions/1071.html) | Empty Code Block | Incomplete | Base | — |
| [CWE-1072](https://cwe.mitre.org/data/definitions/1072.html) | Data Resource Access without Use of Connection Pooling | Incomplete | Base | — |
| [CWE-1073](https://cwe.mitre.org/data/definitions/1073.html) | Non-SQL Invokable Control Element with Excessive Number of Data Resource Accesses | Incomplete | Base | — |
| [CWE-1074](https://cwe.mitre.org/data/definitions/1074.html) | Class with Excessively Deep Inheritance | Incomplete | Base | — |
| [CWE-1075](https://cwe.mitre.org/data/definitions/1075.html) | Unconditional Control Flow Transfer outside of Switch Block | Incomplete | Base | — |
| [CWE-1076](https://cwe.mitre.org/data/definitions/1076.html) | Insufficient Adherence to Expected Conventions | Incomplete | Class | — |
| [CWE-1077](https://cwe.mitre.org/data/definitions/1077.html) | Floating Point Comparison with Incorrect Operator | Incomplete | Variant | — |
| [CWE-1078](https://cwe.mitre.org/data/definitions/1078.html) | Inappropriate Source Code Style or Formatting | Incomplete | Class | — |
| [CWE-1079](https://cwe.mitre.org/data/definitions/1079.html) | Parent Class without Virtual Destructor Method | Incomplete | Base | — |
| [CWE-1080](https://cwe.mitre.org/data/definitions/1080.html) | Source Code File with Excessive Number of Lines of Code | Incomplete | Base | — |
| [CWE-1082](https://cwe.mitre.org/data/definitions/1082.html) | Class Instance Self Destruction Control Element | Incomplete | Base | — |
| [CWE-1083](https://cwe.mitre.org/data/definitions/1083.html) | Data Access from Outside Expected Data Manager Component | Incomplete | Base | — |
| [CWE-1084](https://cwe.mitre.org/data/definitions/1084.html) | Invokable Control Element with Excessive File or Data Access Operations | Incomplete | Base | — |
| [CWE-1085](https://cwe.mitre.org/data/definitions/1085.html) | Invokable Control Element with Excessive Volume of Commented-out Code | Incomplete | Base | — |
| [CWE-1086](https://cwe.mitre.org/data/definitions/1086.html) | Class with Excessive Number of Child Classes | Incomplete | Base | — |
| [CWE-1087](https://cwe.mitre.org/data/definitions/1087.html) | Class with Virtual Method without a Virtual Destructor | Incomplete | Base | — |
| [CWE-1088](https://cwe.mitre.org/data/definitions/1088.html) | Synchronous Access of Remote Resource without Timeout | Incomplete | Base | — |
| [CWE-1089](https://cwe.mitre.org/data/definitions/1089.html) | Large Data Table with Excessive Number of Indices | Incomplete | Base | — |
| [CWE-1090](https://cwe.mitre.org/data/definitions/1090.html) | Method Containing Access of a Member Element from Another Class | Incomplete | Base | — |
| [CWE-1091](https://cwe.mitre.org/data/definitions/1091.html) | Use of Object without Invoking Destructor Method | Incomplete | Base | — |
| [CWE-1092](https://cwe.mitre.org/data/definitions/1092.html) | Use of Same Invokable Control Element in Multiple Architectural Layers | Incomplete | Base | — |
| [CWE-1093](https://cwe.mitre.org/data/definitions/1093.html) | Excessively Complex Data Representation | Incomplete | Class | — |
| [CWE-1094](https://cwe.mitre.org/data/definitions/1094.html) | Excessive Index Range Scan for a Data Resource | Incomplete | Base | — |
| [CWE-1095](https://cwe.mitre.org/data/definitions/1095.html) | Loop Condition Value Update within the Loop | Incomplete | Base | — |
| [CWE-1096](https://cwe.mitre.org/data/definitions/1096.html) | Singleton Class Instance Creation without Proper Locking or Synchronization | Incomplete | Variant | — |
| [CWE-1097](https://cwe.mitre.org/data/definitions/1097.html) | Persistent Storable Data Element without Associated Comparison Control Element | Incomplete | Base | — |
| [CWE-1098](https://cwe.mitre.org/data/definitions/1098.html) | Data Element containing Pointer Item without Proper Copy Control Element | Incomplete | Base | — |
| [CWE-1099](https://cwe.mitre.org/data/definitions/1099.html) | Inconsistent Naming Conventions for Identifiers | Incomplete | Base | — |
| [CWE-1100](https://cwe.mitre.org/data/definitions/1100.html) | Insufficient Isolation of System-Dependent Functions | Incomplete | Base | — |
| [CWE-1101](https://cwe.mitre.org/data/definitions/1101.html) | Reliance on Runtime Component in Generated Code | Incomplete | Base | — |
| [CWE-1102](https://cwe.mitre.org/data/definitions/1102.html) | Reliance on Machine-Dependent Data Representation | Incomplete | Base | — |
| [CWE-1103](https://cwe.mitre.org/data/definitions/1103.html) | Use of Platform-Dependent Third Party Components | Incomplete | Base | — |
| [CWE-1104](https://cwe.mitre.org/data/definitions/1104.html) | Use of Unmaintained Third Party Components | Incomplete | Base | — |
| [CWE-1105](https://cwe.mitre.org/data/definitions/1105.html) | Insufficient Encapsulation of Machine-Dependent Functionality | Incomplete | Base | — |
| [CWE-1106](https://cwe.mitre.org/data/definitions/1106.html) | Insufficient Use of Symbolic Constants | Incomplete | Base | — |
| [CWE-1107](https://cwe.mitre.org/data/definitions/1107.html) | Insufficient Isolation of Symbolic Constant Definitions | Incomplete | Base | — |
| [CWE-1108](https://cwe.mitre.org/data/definitions/1108.html) | Excessive Reliance on Global Variables | Incomplete | Base | — |
| [CWE-1109](https://cwe.mitre.org/data/definitions/1109.html) | Use of Same Variable for Multiple Purposes | Incomplete | Base | — |
| [CWE-1110](https://cwe.mitre.org/data/definitions/1110.html) | Incomplete Design Documentation | Incomplete | Base | — |
| [CWE-1111](https://cwe.mitre.org/data/definitions/1111.html) | Incomplete I/O Documentation | Incomplete | Base | — |
| [CWE-1112](https://cwe.mitre.org/data/definitions/1112.html) | Incomplete Documentation of Program Execution | Incomplete | Base | — |
| [CWE-1113](https://cwe.mitre.org/data/definitions/1113.html) | Inappropriate Comment Style | Incomplete | Base | — |
| [CWE-1114](https://cwe.mitre.org/data/definitions/1114.html) | Inappropriate Whitespace Style | Incomplete | Base | — |
| [CWE-1115](https://cwe.mitre.org/data/definitions/1115.html) | Source Code Element without Standard Prologue | Incomplete | Base | — |
| [CWE-1116](https://cwe.mitre.org/data/definitions/1116.html) | Inaccurate Source Code Comments | Incomplete | Base | Implementation |
| [CWE-1117](https://cwe.mitre.org/data/definitions/1117.html) | Callable with Insufficient Behavioral Summary | Incomplete | Base | — |
| [CWE-1118](https://cwe.mitre.org/data/definitions/1118.html) | Insufficient Documentation of Error Handling Techniques | Incomplete | Base | Documentation |
| [CWE-1119](https://cwe.mitre.org/data/definitions/1119.html) | Excessive Use of Unconditional Branching | Incomplete | Base | — |
| [CWE-1120](https://cwe.mitre.org/data/definitions/1120.html) | Excessive Code Complexity | Incomplete | Class | — |
| [CWE-1121](https://cwe.mitre.org/data/definitions/1121.html) | Excessive McCabe Cyclomatic Complexity | Incomplete | Base | — |
| [CWE-1122](https://cwe.mitre.org/data/definitions/1122.html) | Excessive Halstead Complexity | Incomplete | Base | — |
| [CWE-1123](https://cwe.mitre.org/data/definitions/1123.html) | Excessive Use of Self-Modifying Code | Incomplete | Base | — |
| [CWE-1124](https://cwe.mitre.org/data/definitions/1124.html) | Excessively Deep Nesting | Incomplete | Base | — |
| [CWE-1125](https://cwe.mitre.org/data/definitions/1125.html) | Excessive Attack Surface | Incomplete | Base | — |
| [CWE-1126](https://cwe.mitre.org/data/definitions/1126.html) | Declaration of Variable with Unnecessarily Wide Scope | Incomplete | Base | — |
| [CWE-1127](https://cwe.mitre.org/data/definitions/1127.html) | Compilation with Insufficient Warnings or Errors | Incomplete | Class | Build and Compilation |
| [CWE-1164](https://cwe.mitre.org/data/definitions/1164.html) | Irrelevant Code | Incomplete | Class | — |
| [CWE-1173](https://cwe.mitre.org/data/definitions/1173.html) | Improper Use of Validation Framework | Draft | Base | Implementation |
| [CWE-1174](https://cwe.mitre.org/data/definitions/1174.html) | ASP.NET Misconfiguration: Improper Model Validation | Draft | Variant | — |
| [CWE-1176](https://cwe.mitre.org/data/definitions/1176.html) | Inefficient CPU Computation | Incomplete | Class | — |
| [CWE-1177](https://cwe.mitre.org/data/definitions/1177.html) | Use of Prohibited Code | Incomplete | Class | Build and Compilation; Implementation |
| [CWE-1187](https://cwe.mitre.org/data/definitions/1187.html) | DEPRECATED: Use of Uninitialized Resource | Deprecated | Base | — |
| [CWE-1188](https://cwe.mitre.org/data/definitions/1188.html) | Initialization of a Resource with an Insecure Default | Incomplete | Base | — |
| [CWE-1189](https://cwe.mitre.org/data/definitions/1189.html) | Improper Isolation of Shared Resources on System-on-a-Chip (SoC) | Stable | Base | Architecture and Design |
| [CWE-1190](https://cwe.mitre.org/data/definitions/1190.html) | DMA Device Enabled Too Early in Boot Phase | Draft | Base | Architecture and Design |
| [CWE-1191](https://cwe.mitre.org/data/definitions/1191.html) | On-Chip Debug and Test Interface With Improper Access Control | Stable | Base | Architecture and Design |
| [CWE-1192](https://cwe.mitre.org/data/definitions/1192.html) | Improper Identifier for IP Block used in System-On-Chip (SOC) | Draft | Base | Architecture and Design |
| [CWE-1193](https://cwe.mitre.org/data/definitions/1193.html) | Power-On of Untrusted Execution Core Before Enabling Fabric Access Control | Draft | Base | Architecture and Design |
| [CWE-1204](https://cwe.mitre.org/data/definitions/1204.html) | Generation of Weak Initialization Vector (IV) | Incomplete | Base | Implementation |
| [CWE-1209](https://cwe.mitre.org/data/definitions/1209.html) | Failure to Disable Reserved Bits | Incomplete | Base | Architecture and Design; Implementation; Integration |
| [CWE-1220](https://cwe.mitre.org/data/definitions/1220.html) | Insufficient Granularity of Access Control | Incomplete | Base | Architecture and Design; Implementation; Testing |
| [CWE-1221](https://cwe.mitre.org/data/definitions/1221.html) | Incorrect Register Defaults or Module Parameters | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1222](https://cwe.mitre.org/data/definitions/1222.html) | Insufficient Granularity of Address Regions Protected by Register Locks | Incomplete | Variant | Architecture and Design |
| [CWE-1223](https://cwe.mitre.org/data/definitions/1223.html) | Race Condition for Write-Once Attributes | Incomplete | Base | Architecture and Design |
| [CWE-1224](https://cwe.mitre.org/data/definitions/1224.html) | Improper Restriction of Write-Once Bit Fields | Incomplete | Base | Architecture and Design |
| [CWE-1229](https://cwe.mitre.org/data/definitions/1229.html) | Creation of Emergent Resource | Incomplete | Class | — |
| [CWE-1230](https://cwe.mitre.org/data/definitions/1230.html) | Exposure of Sensitive Information Through Metadata | Incomplete | Base | — |
| [CWE-1231](https://cwe.mitre.org/data/definitions/1231.html) | Improper Prevention of Lock Bit Modification | Stable | Base | Architecture and Design; Implementation; Testing |
| [CWE-1232](https://cwe.mitre.org/data/definitions/1232.html) | Improper Lock Behavior After Power State Transition | Incomplete | Base | Architecture and Design; Implementation; Testing |
| [CWE-1233](https://cwe.mitre.org/data/definitions/1233.html) | Security-Sensitive Hardware Controls with Missing Lock Bit Protection | Stable | Base | Architecture and Design; Implementation; Testing |
| [CWE-1234](https://cwe.mitre.org/data/definitions/1234.html) | Hardware Internal or Debug Modes Allow Override of Locks | Incomplete | Base | Architecture and Design; Implementation; Testing |
| [CWE-1235](https://cwe.mitre.org/data/definitions/1235.html) | Incorrect Use of Autoboxing and Unboxing for Performance Critical Operations | Incomplete | Base | Implementation |
| [CWE-1236](https://cwe.mitre.org/data/definitions/1236.html) | Improper Neutralization of Formula Elements in a CSV File | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1239](https://cwe.mitre.org/data/definitions/1239.html) | Improper Zeroization of Hardware Register | Draft | Variant | Architecture and Design |
| [CWE-1240](https://cwe.mitre.org/data/definitions/1240.html) | Use of a Cryptographic Primitive with a Risky Implementation | Draft | Base | Architecture and Design; Implementation; Requirements |
| [CWE-1241](https://cwe.mitre.org/data/definitions/1241.html) | Use of Predictable Algorithm in Random Number Generator | Draft | Base | Architecture and Design; Implementation |
| [CWE-1242](https://cwe.mitre.org/data/definitions/1242.html) | Inclusion of Undocumented Features or Chicken Bits | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1243](https://cwe.mitre.org/data/definitions/1243.html) | Sensitive Non-Volatile Information Not Protected During Debug | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1244](https://cwe.mitre.org/data/definitions/1244.html) | Internal Asset Exposed to Unsafe Debug Access Level or State | Stable | Base | Architecture and Design; Implementation |
| [CWE-1245](https://cwe.mitre.org/data/definitions/1245.html) | Improper Finite State Machines (FSMs) in Hardware Logic | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1246](https://cwe.mitre.org/data/definitions/1246.html) | Improper Write Handling in Limited-write Non-Volatile Memories | Incomplete | Base | Architecture and Design; Implementation; Testing |
| [CWE-1247](https://cwe.mitre.org/data/definitions/1247.html) | Improper Protection Against Voltage and Clock Glitches | Stable | Base | Architecture and Design; Implementation |
| [CWE-1248](https://cwe.mitre.org/data/definitions/1248.html) | Semiconductor Defects in Hardware Logic with Security-Sensitive Implications | Incomplete | Base | Operation; Testing |
| [CWE-1249](https://cwe.mitre.org/data/definitions/1249.html) | Application-Level Admin Tool with Inconsistent View of Underlying Operating System | Incomplete | Base | Architecture and Design |
| [CWE-1250](https://cwe.mitre.org/data/definitions/1250.html) | Improper Preservation of Consistency Between Independent Representations of Shared State | Incomplete | Class | — |
| [CWE-1251](https://cwe.mitre.org/data/definitions/1251.html) | Mirrored Regions with Different Values | Incomplete | Base | Architecture and Design |
| [CWE-1252](https://cwe.mitre.org/data/definitions/1252.html) | CPU Hardware Not Configured to Support Exclusivity of Write and Execute Operations | Incomplete | Base | Architecture and Design; Integration |
| [CWE-1253](https://cwe.mitre.org/data/definitions/1253.html) | Incorrect Selection of Fuse Values | Draft | Base | Architecture and Design |
| [CWE-1254](https://cwe.mitre.org/data/definitions/1254.html) | Incorrect Comparison Logic Granularity | Draft | Base | Implementation |
| [CWE-1255](https://cwe.mitre.org/data/definitions/1255.html) | Comparison Logic is Vulnerable to Power Side-Channel Attacks | Draft | Variant | Architecture and Design; Implementation; Integration |
| [CWE-1256](https://cwe.mitre.org/data/definitions/1256.html) | Improper Restriction of Software Interfaces to Hardware Features | Stable | Base | Architecture and Design; Implementation |
| [CWE-1257](https://cwe.mitre.org/data/definitions/1257.html) | Improper Access Control Applied to Mirrored or Aliased Memory Regions | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1258](https://cwe.mitre.org/data/definitions/1258.html) | Exposure of Sensitive System Information Due to Uncleared Debug Information | Draft | Base | Architecture and Design |
| [CWE-1259](https://cwe.mitre.org/data/definitions/1259.html) | Improper Restriction of Security Token Assignment | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1260](https://cwe.mitre.org/data/definitions/1260.html) | Improper Handling of Overlap Between Protected Memory Ranges | Stable | Base | Architecture and Design; Implementation |
| [CWE-1261](https://cwe.mitre.org/data/definitions/1261.html) | Improper Handling of Single Event Upsets | Draft | Base | Architecture and Design |
| [CWE-1262](https://cwe.mitre.org/data/definitions/1262.html) | Improper Access Control for Register Interface | Stable | Base | Architecture and Design; Implementation |
| [CWE-1263](https://cwe.mitre.org/data/definitions/1263.html) | Improper Physical Access Control | Incomplete | Class | Architecture and Design; Manufacturing; Testing |
| [CWE-1264](https://cwe.mitre.org/data/definitions/1264.html) | Hardware Logic with Insecure De-Synchronization between Control and Data Channels | Incomplete | Base | Architecture and Design |
| [CWE-1265](https://cwe.mitre.org/data/definitions/1265.html) | Unintended Reentrant Invocation of Non-reentrant Code Via Nested Calls | Draft | Base | Architecture and Design; Implementation |
| [CWE-1266](https://cwe.mitre.org/data/definitions/1266.html) | Improper Scrubbing of Sensitive Data from Decommissioned Device | Incomplete | Base | Architecture and Design; Implementation; Policy |
| [CWE-1267](https://cwe.mitre.org/data/definitions/1267.html) | Policy Uses Obsolete Encoding | Draft | Base | Architecture and Design; Implementation |
| [CWE-1268](https://cwe.mitre.org/data/definitions/1268.html) | Policy Privileges are not Assigned Consistently Between Control and Data Agents | Draft | Base | Architecture and Design; Implementation |
| [CWE-1269](https://cwe.mitre.org/data/definitions/1269.html) | Product Released in Non-Release Configuration | Incomplete | Base | Implementation; Integration; Manufacturing |
| [CWE-1270](https://cwe.mitre.org/data/definitions/1270.html) | Generation of Incorrect Security Tokens | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1271](https://cwe.mitre.org/data/definitions/1271.html) | Uninitialized Value on Reset for Registers Holding Security Settings | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1272](https://cwe.mitre.org/data/definitions/1272.html) | Sensitive Information Uncleared Before Debug/Power State Transition | Stable | Base | Architecture and Design; Implementation |
| [CWE-1273](https://cwe.mitre.org/data/definitions/1273.html) | Device Unlock Credential Sharing | Incomplete | Base | Integration; Manufacturing |
| [CWE-1274](https://cwe.mitre.org/data/definitions/1274.html) | Improper Access Control for Volatile Memory Containing Boot Code | Stable | Base | Architecture and Design; Testing |
| [CWE-1275](https://cwe.mitre.org/data/definitions/1275.html) | Sensitive Cookie with Improper SameSite Attribute | Incomplete | Variant | Implementation |
| [CWE-1276](https://cwe.mitre.org/data/definitions/1276.html) | Hardware Child Block Incorrectly Connected to Parent System | Incomplete | Base | Testing |
| [CWE-1277](https://cwe.mitre.org/data/definitions/1277.html) | Firmware Not Updateable | Draft | Base | Architecture and Design; Implementation; Requirements |
| [CWE-1278](https://cwe.mitre.org/data/definitions/1278.html) | Missing Protection Against Hardware Reverse Engineering Using Integrated Circuit (IC) Imaging Techniques | Incomplete | Base | Architecture and Design |
| [CWE-1279](https://cwe.mitre.org/data/definitions/1279.html) | Cryptographic Operations are Run Before Supporting Units are Ready | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1280](https://cwe.mitre.org/data/definitions/1280.html) | Access Control Check Implemented After Asset is Accessed | Incomplete | Base | Implementation |
| [CWE-1281](https://cwe.mitre.org/data/definitions/1281.html) | Sequence of Processor Instructions Leads to Unexpected Behavior | Incomplete | Base | Patching and Maintenance; Testing |
| [CWE-1282](https://cwe.mitre.org/data/definitions/1282.html) | Assumed-Immutable Data is Stored in Writable Memory | Incomplete | Base | Implementation |
| [CWE-1283](https://cwe.mitre.org/data/definitions/1283.html) | Mutable Attestation or Measurement Reporting Data | Incomplete | Base | Architecture and Design |
| [CWE-1284](https://cwe.mitre.org/data/definitions/1284.html) | Improper Validation of Specified Quantity in Input | Incomplete | Base | Implementation |
| [CWE-1285](https://cwe.mitre.org/data/definitions/1285.html) | Improper Validation of Specified Index, Position, or Offset in Input | Incomplete | Base | Implementation |
| [CWE-1286](https://cwe.mitre.org/data/definitions/1286.html) | Improper Validation of Syntactic Correctness of Input | Incomplete | Base | Implementation |
| [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html) | Improper Validation of Specified Type of Input | Incomplete | Base | Implementation |
| [CWE-1288](https://cwe.mitre.org/data/definitions/1288.html) | Improper Validation of Consistency within Input | Incomplete | Base | Implementation |
| [CWE-1289](https://cwe.mitre.org/data/definitions/1289.html) | Improper Validation of Unsafe Equivalence in Input | Incomplete | Base | Implementation |
| [CWE-1290](https://cwe.mitre.org/data/definitions/1290.html) | Incorrect Decoding of Security Identifiers | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1291](https://cwe.mitre.org/data/definitions/1291.html) | Public Key Re-Use for Signing both Debug and Production Code | Draft | Base | Implementation |
| [CWE-1292](https://cwe.mitre.org/data/definitions/1292.html) | Incorrect Conversion of Security Identifiers | Draft | Base | Architecture and Design; Implementation |
| [CWE-1293](https://cwe.mitre.org/data/definitions/1293.html) | Missing Source Correlation of Multiple Independent Data | Draft | Base | Implementation; Requirements |
| [CWE-1294](https://cwe.mitre.org/data/definitions/1294.html) | Insecure Security Identifier Mechanism | Incomplete | Class | Architecture and Design; Implementation |
| [CWE-1295](https://cwe.mitre.org/data/definitions/1295.html) | Debug Messages Revealing Unnecessary Information | Incomplete | Base | Implementation |
| [CWE-1296](https://cwe.mitre.org/data/definitions/1296.html) | Incorrect Chaining or Granularity of Debug Components | Incomplete | Base | Implementation |
| [CWE-1297](https://cwe.mitre.org/data/definitions/1297.html) | Unprotected Confidential Information on Device is Accessible by OSAT Vendors | Incomplete | Base | Architecture and Design |
| [CWE-1298](https://cwe.mitre.org/data/definitions/1298.html) | Hardware Logic Contains Race Conditions | Draft | Base | Architecture and Design; Implementation |
| [CWE-1299](https://cwe.mitre.org/data/definitions/1299.html) | Missing Protection Mechanism for Alternate Hardware Interface | Draft | Base | Architecture and Design; Implementation; Requirements |
| [CWE-1300](https://cwe.mitre.org/data/definitions/1300.html) | Improper Protection of Physical Side Channels | Stable | Base | Architecture and Design; Implementation |
| [CWE-1301](https://cwe.mitre.org/data/definitions/1301.html) | Insufficient or Incomplete Data Removal within Hardware Component | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1302](https://cwe.mitre.org/data/definitions/1302.html) | Missing Source Identifier in Entity Transactions on a System-On-Chip (SOC) | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1303](https://cwe.mitre.org/data/definitions/1303.html) | Non-Transparent Sharing of Microarchitectural Resources | Draft | Base | Architecture and Design; Requirements |
| [CWE-1304](https://cwe.mitre.org/data/definitions/1304.html) | Improperly Preserved Integrity of Hardware Configuration State During a Power Save/Restore Operation | Draft | Base | Architecture and Design; Integration |
| [CWE-1310](https://cwe.mitre.org/data/definitions/1310.html) | Missing Ability to Patch ROM Code | Draft | Base | Architecture and Design; Implementation |
| [CWE-1311](https://cwe.mitre.org/data/definitions/1311.html) | Improper Translation of Security Attributes by Fabric Bridge | Draft | Base | Architecture and Design; Implementation |
| [CWE-1312](https://cwe.mitre.org/data/definitions/1312.html) | Missing Protection for Mirrored Regions in On-Chip Fabric Firewall | Draft | Base | Architecture and Design; Implementation |
| [CWE-1313](https://cwe.mitre.org/data/definitions/1313.html) | Hardware Allows Activation of Test or Debug Logic at Runtime | Draft | Base | Architecture and Design; Implementation; Integration |
| [CWE-1314](https://cwe.mitre.org/data/definitions/1314.html) | Missing Write Protection for Parametric Data Values | Draft | Base | Architecture and Design |
| [CWE-1315](https://cwe.mitre.org/data/definitions/1315.html) | Improper Setting of Bus Controlling Capability in Fabric End-point | Incomplete | Base | Architecture and Design; Implementation; System Configuration |
| [CWE-1316](https://cwe.mitre.org/data/definitions/1316.html) | Fabric-Address Map Allows Programming of Unwarranted Overlaps of Protected and Unprotected Ranges | Draft | Base | Architecture and Design; Implementation; Testing |
| [CWE-1317](https://cwe.mitre.org/data/definitions/1317.html) | Improper Access Control in Fabric Bridge | Draft | Base | Architecture and Design; Implementation |
| [CWE-1318](https://cwe.mitre.org/data/definitions/1318.html) | Missing Support for Security Features in On-chip Fabrics or Buses | Incomplete | Base | Architecture and Design |
| [CWE-1319](https://cwe.mitre.org/data/definitions/1319.html) | Improper Protection against Electromagnetic Fault Injection (EM-FI) | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1320](https://cwe.mitre.org/data/definitions/1320.html) | Improper Protection for Outbound Error Messages and Alert Signals | Draft | Base | Architecture and Design |
| [CWE-1321](https://cwe.mitre.org/data/definitions/1321.html) | Improperly Controlled Modification of Object Prototype Attributes | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-1322](https://cwe.mitre.org/data/definitions/1322.html) | Use of Blocking Code in Single-threaded, Non-blocking Context | Incomplete | Base | Implementation |
| [CWE-1323](https://cwe.mitre.org/data/definitions/1323.html) | Improper Management of Sensitive Trace Data | Draft | Base | Implementation |
| [CWE-1324](https://cwe.mitre.org/data/definitions/1324.html) | DEPRECATED: Sensitive Information Accessible by Physical Probing of JTAG Interface | Deprecated | Base | — |
| [CWE-1325](https://cwe.mitre.org/data/definitions/1325.html) | Improperly Controlled Sequential Memory Allocation | Incomplete | Base | Implementation; Operation |
| [CWE-1326](https://cwe.mitre.org/data/definitions/1326.html) | Missing Immutable Root of Trust in Hardware | Draft | Base | Architecture and Design; Implementation |
| [CWE-1327](https://cwe.mitre.org/data/definitions/1327.html) | Binding to an Unrestricted IP Address | Incomplete | Base | System Configuration |
| [CWE-1328](https://cwe.mitre.org/data/definitions/1328.html) | Security Version Number Mutable to Older Versions | Draft | Base | Architecture and Design; Implementation |
| [CWE-1329](https://cwe.mitre.org/data/definitions/1329.html) | Reliance on Component That is Not Updateable | Incomplete | Class | Architecture and Design; Implementation; Requirements |
| [CWE-1330](https://cwe.mitre.org/data/definitions/1330.html) | Remanent Data Readable after Memory Erase | Draft | Variant | Architecture and Design |
| [CWE-1331](https://cwe.mitre.org/data/definitions/1331.html) | Improper Isolation of Shared Resources in Network On Chip (NoC) | Stable | Base | Architecture and Design; Implementation |
| [CWE-1332](https://cwe.mitre.org/data/definitions/1332.html) | Improper Handling of Faults that Lead to Instruction Skips | Stable | Base | Architecture and Design; Implementation |
| [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html) | Inefficient Regular Expression Complexity | Draft | Base | Architecture and Design; Implementation; System Configuration |
| [CWE-1334](https://cwe.mitre.org/data/definitions/1334.html) | Unauthorized Error Injection Can Degrade Hardware Redundancy | Draft | Base | Architecture and Design; Implementation; Integration |
| [CWE-1335](https://cwe.mitre.org/data/definitions/1335.html) | Incorrect Bitwise Shift of Integer | Draft | Base | Implementation |
| [CWE-1336](https://cwe.mitre.org/data/definitions/1336.html) | Improper Neutralization of Special Elements Used in a Template Engine | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1338](https://cwe.mitre.org/data/definitions/1338.html) | Improper Protections Against Hardware Overheating | Draft | Base | Architecture and Design; Implementation |
| [CWE-1339](https://cwe.mitre.org/data/definitions/1339.html) | Insufficient Precision or Accuracy of a Real Number | Draft | Base | Implementation; Patching and Maintenance |
| [CWE-1341](https://cwe.mitre.org/data/definitions/1341.html) | Multiple Releases of Same Resource or Handle | Incomplete | Base | Implementation |
| [CWE-1342](https://cwe.mitre.org/data/definitions/1342.html) | Information Exposure through Microarchitectural State after Transient Execution | Incomplete | Base | Architecture and Design; Build and Compilation; Requirements |
| [CWE-1351](https://cwe.mitre.org/data/definitions/1351.html) | Improper Handling of Hardware Behavior in Exceptionally Cold Environments | Incomplete | Base | Architecture and Design |
| [CWE-1357](https://cwe.mitre.org/data/definitions/1357.html) | Reliance on Insufficiently Trustworthy Component | Incomplete | Class | Architecture and Design; Implementation; Integration; Manufacturing; Operation; Patching and Maintenance; Requirements |
| [CWE-1384](https://cwe.mitre.org/data/definitions/1384.html) | Improper Handling of Physical or Environmental Conditions | Incomplete | Class | Architecture and Design; Implementation; Requirements |
| [CWE-1385](https://cwe.mitre.org/data/definitions/1385.html) | Missing Origin Validation in WebSockets | Incomplete | Variant | Architecture and Design; Implementation |
| [CWE-1386](https://cwe.mitre.org/data/definitions/1386.html) | Insecure Operation on Windows Junction / Mount Point | Incomplete | Base | Architecture and Design |
| [CWE-1389](https://cwe.mitre.org/data/definitions/1389.html) | Incorrect Parsing of Numbers with Different Radices | Incomplete | Base | Implementation |
| [CWE-1390](https://cwe.mitre.org/data/definitions/1390.html) | Weak Authentication | Incomplete | Class | — |
| [CWE-1391](https://cwe.mitre.org/data/definitions/1391.html) | Use of Weak Credentials | Incomplete | Class | Architecture and Design; Operation |
| [CWE-1392](https://cwe.mitre.org/data/definitions/1392.html) | Use of Default Credentials | Incomplete | Base | Architecture and Design; Installation; Operation; Requirements |
| [CWE-1393](https://cwe.mitre.org/data/definitions/1393.html) | Use of Default Password | Incomplete | Base | Architecture and Design; Documentation; Installation; Operation; Requirements |
| [CWE-1394](https://cwe.mitre.org/data/definitions/1394.html) | Use of Default Cryptographic Key | Incomplete | Base | Architecture and Design; Installation; Operation; Requirements |
| [CWE-1395](https://cwe.mitre.org/data/definitions/1395.html) | Dependency on Vulnerable Third-Party Component | Incomplete | Class | Architecture and Design; Implementation; Integration; Manufacturing; Operation; Patching and Maintenance; Policy; Requirements |
| [CWE-1419](https://cwe.mitre.org/data/definitions/1419.html) | Incorrect Initialization of Resource | Incomplete | Class | Architecture and Design; Implementation |
| [CWE-1420](https://cwe.mitre.org/data/definitions/1420.html) | Exposure of Sensitive Information during Transient Execution | Incomplete | Base | Architecture and Design; Build and Compilation; Documentation; Requirements |
| [CWE-1421](https://cwe.mitre.org/data/definitions/1421.html) | Exposure of Sensitive Information in Shared Microarchitectural Structures during Transient Execution | Incomplete | Base | Architecture and Design; Build and Compilation; Implementation; Patching and Maintenance; Requirements; System Configuration |
| [CWE-1422](https://cwe.mitre.org/data/definitions/1422.html) | Exposure of Sensitive Information caused by Incorrect Data Forwarding during Transient Execution | Incomplete | Base | Architecture and Design; Build and Compilation; Documentation; Requirements |
| [CWE-1423](https://cwe.mitre.org/data/definitions/1423.html) | Exposure of Sensitive Information caused by Shared Microarchitectural Predictor State that Influences Transient Execution | Incomplete | Base | Architecture and Design; Build and Compilation; Documentation; Implementation; Patching and Maintenance; Requirements; System Configuration |
| [CWE-1426](https://cwe.mitre.org/data/definitions/1426.html) | Improper Validation of Generative AI Output | Incomplete | Base | Architecture and Design; Build and Compilation; Operation; Training |
| [CWE-1427](https://cwe.mitre.org/data/definitions/1427.html) | Improper Neutralization of Input Used for LLM Prompting | Incomplete | Base | Architecture and Design; Implementation; Installation; Operation; System Configuration |
| [CWE-1428](https://cwe.mitre.org/data/definitions/1428.html) | Reliance on HTTP instead of HTTPS | Incomplete | Base | Architecture and Design; Implementation; Operation |
| [CWE-1429](https://cwe.mitre.org/data/definitions/1429.html) | Missing Security-Relevant Feedback for Unexecuted Operations in Hardware Interface | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1431](https://cwe.mitre.org/data/definitions/1431.html) | Driving Intermediate Cryptographic State/Results to Hardware Module Outputs | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1434](https://cwe.mitre.org/data/definitions/1434.html) | Insecure Setting of Generative AI/ML Model Inference Parameters | Draft | Base | Documentation; Fine-tuning; Implementation; Operation; System Configuration |
| [CWE-1461](https://cwe.mitre.org/data/definitions/1461.html) | Hardware Simulation / Synthesis Mismatch | Incomplete | Base | Implementation & Physical Design |
| [CWE-1462](https://cwe.mitre.org/data/definitions/1462.html) | Improper Session Management | Incomplete | Class | Architecture and Design; Implementation; Operation |
| [CWE-1463](https://cwe.mitre.org/data/definitions/1463.html) | Insufficient Session Timeout Value | Incomplete | Base | Implementation |
| [CWE-1464](https://cwe.mitre.org/data/definitions/1464.html) | Improper Session Invalidation | Incomplete | Base | Implementation |
| [CWE-1465](https://cwe.mitre.org/data/definitions/1465.html) | Improper Session Invalidation after User Logout | Incomplete | Variant | Implementation |
| [CWE-1466](https://cwe.mitre.org/data/definitions/1466.html) | Improper Session Invalidation after Authentication Credential Change | Incomplete | Variant | Implementation |
| [CWE-1467](https://cwe.mitre.org/data/definitions/1467.html) | Use of Singular Authentication Artifact for Multiple User Sessions | Incomplete | Base | Implementation |
| [CWE-1469](https://cwe.mitre.org/data/definitions/1469.html) | Improper Check for Credential Expiration | Incomplete | Base | Architecture and Design; Implementation |
| [CWE-1470](https://cwe.mitre.org/data/definitions/1470.html) | Improper External Identity Verification | Incomplete | Class | Architecture and Design; Implementation |
| [CWE-1471](https://cwe.mitre.org/data/definitions/1471.html) | Insufficiently Controlled Parser Differential | Incomplete | Class | Architecture and Design; Implementation |
| [CWE-1472](https://cwe.mitre.org/data/definitions/1472.html) | Generation of Credential with Long Expiration | Incomplete | Base | Architecture and Design; Implementation; Operation |
| [CWE-1473](https://cwe.mitre.org/data/definitions/1473.html) | Improper Expiration of Cached Data | Incomplete | Class | Architecture and Design; Implementation |
| [CWE-1474](https://cwe.mitre.org/data/definitions/1474.html) | Non-Equivalent Data Transformation | Incomplete | Class | Architecture and Design; Implementation |
| [CWE-1475](https://cwe.mitre.org/data/definitions/1475.html) | Incomplete Data/State Propagation | Incomplete | Class | Implementation |
| [CWE-1476](https://cwe.mitre.org/data/definitions/1476.html) | Improper Request Propagation before Data Reception in Write Transactions in a Bus Architecture | Incomplete | Base | Hardware Architecture; Hardware Microarchitecture |

## 分组（431）

| 官方 ID | 名称 | 状态 | 抽象层级 / 类型 | 修复阶段（公告提供时） |
| --- | --- | --- | --- | --- |
| [CWE-1](https://cwe.mitre.org/data/definitions/1.html) | DEPRECATED: Location | Deprecated | — | — |
| [CWE-2](https://cwe.mitre.org/data/definitions/2.html) | 7PK - Environment | Draft | — | — |
| [CWE-3](https://cwe.mitre.org/data/definitions/3.html) | DEPRECATED: Technology-specific Environment Issues | Deprecated | — | — |
| [CWE-4](https://cwe.mitre.org/data/definitions/4.html) | DEPRECATED: J2EE Environment Issues | Deprecated | — | — |
| [CWE-10](https://cwe.mitre.org/data/definitions/10.html) | DEPRECATED: ASP.NET Environment Issues | Deprecated | — | — |
| [CWE-16](https://cwe.mitre.org/data/definitions/16.html) | Configuration | Obsolete | — | — |
| [CWE-17](https://cwe.mitre.org/data/definitions/17.html) | DEPRECATED: Code | Deprecated | — | — |
| [CWE-18](https://cwe.mitre.org/data/definitions/18.html) | DEPRECATED: Source Code | Deprecated | — | — |
| [CWE-19](https://cwe.mitre.org/data/definitions/19.html) | Data Processing Errors | Draft | — | — |
| [CWE-21](https://cwe.mitre.org/data/definitions/21.html) | DEPRECATED: Pathname Traversal and Equivalence Errors | Deprecated | — | — |
| [CWE-60](https://cwe.mitre.org/data/definitions/60.html) | DEPRECATED: UNIX Path Link Problems | Deprecated | — | — |
| [CWE-63](https://cwe.mitre.org/data/definitions/63.html) | DEPRECATED: Windows Path Link Problems | Deprecated | — | — |
| [CWE-68](https://cwe.mitre.org/data/definitions/68.html) | DEPRECATED: Windows Virtual File Problems | Deprecated | — | — |
| [CWE-70](https://cwe.mitre.org/data/definitions/70.html) | DEPRECATED: Mac Virtual File Problems | Deprecated | — | — |
| [CWE-100](https://cwe.mitre.org/data/definitions/100.html) | DEPRECATED: Technology-Specific Input Validation Problems | Deprecated | — | — |
| [CWE-101](https://cwe.mitre.org/data/definitions/101.html) | DEPRECATED: Struts Validation Problems | Deprecated | — | — |
| [CWE-133](https://cwe.mitre.org/data/definitions/133.html) | String Errors | Draft | — | — |
| [CWE-136](https://cwe.mitre.org/data/definitions/136.html) | Type Errors | Draft | — | — |
| [CWE-137](https://cwe.mitre.org/data/definitions/137.html) | Data Neutralization Issues | Draft | — | — |
| [CWE-139](https://cwe.mitre.org/data/definitions/139.html) | DEPRECATED: General Special Element Problems | Deprecated | — | — |
| [CWE-169](https://cwe.mitre.org/data/definitions/169.html) | DEPRECATED: Technology-Specific Special Elements | Deprecated | — | — |
| [CWE-171](https://cwe.mitre.org/data/definitions/171.html) | DEPRECATED: Cleansing, Canonicalization, and Comparison Errors | Deprecated | — | — |
| [CWE-189](https://cwe.mitre.org/data/definitions/189.html) | Numeric Errors | Draft | — | — |
| [CWE-199](https://cwe.mitre.org/data/definitions/199.html) | Information Management Errors | Draft | — | — |
| [CWE-227](https://cwe.mitre.org/data/definitions/227.html) | 7PK - API Abuse | Draft | — | — |
| [CWE-251](https://cwe.mitre.org/data/definitions/251.html) | Often Misused: String Management | Incomplete | — | — |
| [CWE-254](https://cwe.mitre.org/data/definitions/254.html) | 7PK - Security Features | Incomplete | — | — |
| [CWE-255](https://cwe.mitre.org/data/definitions/255.html) | Credentials Management Errors | Draft | — | — |
| [CWE-264](https://cwe.mitre.org/data/definitions/264.html) | Permissions, Privileges, and Access Controls | Obsolete | — | — |
| [CWE-265](https://cwe.mitre.org/data/definitions/265.html) | Privilege Issues | Incomplete | — | — |
| [CWE-275](https://cwe.mitre.org/data/definitions/275.html) | Permission Issues | Draft | — | — |
| [CWE-310](https://cwe.mitre.org/data/definitions/310.html) | Cryptographic Issues | Draft | — | — |
| [CWE-320](https://cwe.mitre.org/data/definitions/320.html) | Key Management Errors | Obsolete | — | — |
| [CWE-355](https://cwe.mitre.org/data/definitions/355.html) | User Interface Security Issues | Draft | — | — |
| [CWE-361](https://cwe.mitre.org/data/definitions/361.html) | 7PK - Time and State | Incomplete | — | — |
| [CWE-371](https://cwe.mitre.org/data/definitions/371.html) | State Issues | Draft | — | — |
| [CWE-376](https://cwe.mitre.org/data/definitions/376.html) | DEPRECATED: Temporary File Issues | Deprecated | — | — |
| [CWE-380](https://cwe.mitre.org/data/definitions/380.html) | DEPRECATED: Technology-Specific Time and State Issues | Deprecated | — | — |
| [CWE-381](https://cwe.mitre.org/data/definitions/381.html) | DEPRECATED: J2EE Time and State Issues | Deprecated | — | — |
| [CWE-387](https://cwe.mitre.org/data/definitions/387.html) | Signal Errors | Incomplete | — | — |
| [CWE-388](https://cwe.mitre.org/data/definitions/388.html) | 7PK - Errors | Draft | — | — |
| [CWE-389](https://cwe.mitre.org/data/definitions/389.html) | Error Conditions, Return Values, Status Codes | Incomplete | — | — |
| [CWE-398](https://cwe.mitre.org/data/definitions/398.html) | 7PK - Code Quality | Draft | — | — |
| [CWE-399](https://cwe.mitre.org/data/definitions/399.html) | Resource Management Errors | Draft | — | — |
| [CWE-411](https://cwe.mitre.org/data/definitions/411.html) | Resource Locking Problems | Draft | — | — |
| [CWE-417](https://cwe.mitre.org/data/definitions/417.html) | Communication Channel Errors | Draft | — | — |
| [CWE-418](https://cwe.mitre.org/data/definitions/418.html) | DEPRECATED: Channel Errors | Deprecated | — | — |
| [CWE-429](https://cwe.mitre.org/data/definitions/429.html) | Handler Errors | Draft | — | — |
| [CWE-438](https://cwe.mitre.org/data/definitions/438.html) | Behavioral Problems | Draft | — | — |
| [CWE-442](https://cwe.mitre.org/data/definitions/442.html) | DEPRECATED: Web Problems | Deprecated | — | — |
| [CWE-445](https://cwe.mitre.org/data/definitions/445.html) | DEPRECATED: User Interface Errors | Deprecated | — | — |
| [CWE-452](https://cwe.mitre.org/data/definitions/452.html) | Initialization and Cleanup Errors | Draft | — | — |
| [CWE-461](https://cwe.mitre.org/data/definitions/461.html) | DEPRECATED: Data Structure Issues | Deprecated | — | — |
| [CWE-465](https://cwe.mitre.org/data/definitions/465.html) | Pointer Issues | Draft | — | — |
| [CWE-485](https://cwe.mitre.org/data/definitions/485.html) | 7PK - Encapsulation | Draft | — | — |
| [CWE-490](https://cwe.mitre.org/data/definitions/490.html) | DEPRECATED: Mobile Code Issues | Deprecated | — | — |
| [CWE-503](https://cwe.mitre.org/data/definitions/503.html) | DEPRECATED: Byte/Object Code | Deprecated | — | — |
| [CWE-504](https://cwe.mitre.org/data/definitions/504.html) | DEPRECATED: Motivation/Intent | Deprecated | — | — |
| [CWE-505](https://cwe.mitre.org/data/definitions/505.html) | DEPRECATED: Intentionally Introduced Weakness | Deprecated | — | — |
| [CWE-513](https://cwe.mitre.org/data/definitions/513.html) | DEPRECATED: Intentionally Introduced Nonmalicious Weakness | Deprecated | — | — |
| [CWE-517](https://cwe.mitre.org/data/definitions/517.html) | DEPRECATED: Other Intentional, Nonmalicious Weakness | Deprecated | — | — |
| [CWE-518](https://cwe.mitre.org/data/definitions/518.html) | DEPRECATED: Inadvertently Introduced Weakness | Deprecated | — | — |
| [CWE-519](https://cwe.mitre.org/data/definitions/519.html) | DEPRECATED: .NET Environment Issues | Deprecated | — | — |
| [CWE-557](https://cwe.mitre.org/data/definitions/557.html) | Concurrency Issues | Draft | — | — |
| [CWE-559](https://cwe.mitre.org/data/definitions/559.html) | DEPRECATED: Often Misused: Arguments and Parameters | Deprecated | — | — |
| [CWE-569](https://cwe.mitre.org/data/definitions/569.html) | Expression Issues | Draft | — | — |
| [CWE-632](https://cwe.mitre.org/data/definitions/632.html) | DEPRECATED: Weaknesses that Affect Files or Directories | Deprecated | — | — |
| [CWE-633](https://cwe.mitre.org/data/definitions/633.html) | DEPRECATED: Weaknesses that Affect Memory | Deprecated | — | — |
| [CWE-634](https://cwe.mitre.org/data/definitions/634.html) | DEPRECATED: Weaknesses that Affect System Processes | Deprecated | — | — |
| [CWE-712](https://cwe.mitre.org/data/definitions/712.html) | OWASP Top Ten 2007 Category A1 - Cross Site Scripting (XSS) | Obsolete | — | — |
| [CWE-713](https://cwe.mitre.org/data/definitions/713.html) | OWASP Top Ten 2007 Category A2 - Injection Flaws | Obsolete | — | — |
| [CWE-714](https://cwe.mitre.org/data/definitions/714.html) | OWASP Top Ten 2007 Category A3 - Malicious File Execution | Obsolete | — | — |
| [CWE-715](https://cwe.mitre.org/data/definitions/715.html) | OWASP Top Ten 2007 Category A4 - Insecure Direct Object Reference | Obsolete | — | — |
| [CWE-716](https://cwe.mitre.org/data/definitions/716.html) | OWASP Top Ten 2007 Category A5 - Cross Site Request Forgery (CSRF) | Obsolete | — | — |
| [CWE-717](https://cwe.mitre.org/data/definitions/717.html) | OWASP Top Ten 2007 Category A6 - Information Leakage and Improper Error Handling | Obsolete | — | — |
| [CWE-718](https://cwe.mitre.org/data/definitions/718.html) | OWASP Top Ten 2007 Category A7 - Broken Authentication and Session Management | Obsolete | — | — |
| [CWE-719](https://cwe.mitre.org/data/definitions/719.html) | OWASP Top Ten 2007 Category A8 - Insecure Cryptographic Storage | Obsolete | — | — |
| [CWE-720](https://cwe.mitre.org/data/definitions/720.html) | OWASP Top Ten 2007 Category A9 - Insecure Communications | Obsolete | — | — |
| [CWE-721](https://cwe.mitre.org/data/definitions/721.html) | OWASP Top Ten 2007 Category A10 - Failure to Restrict URL Access | Obsolete | — | — |
| [CWE-722](https://cwe.mitre.org/data/definitions/722.html) | OWASP Top Ten 2004 Category A1 - Unvalidated Input | Obsolete | — | — |
| [CWE-723](https://cwe.mitre.org/data/definitions/723.html) | OWASP Top Ten 2004 Category A2 - Broken Access Control | Obsolete | — | — |
| [CWE-724](https://cwe.mitre.org/data/definitions/724.html) | OWASP Top Ten 2004 Category A3 - Broken Authentication and Session Management | Obsolete | — | — |
| [CWE-725](https://cwe.mitre.org/data/definitions/725.html) | OWASP Top Ten 2004 Category A4 - Cross-Site Scripting (XSS) Flaws | Obsolete | — | — |
| [CWE-726](https://cwe.mitre.org/data/definitions/726.html) | OWASP Top Ten 2004 Category A5 - Buffer Overflows | Obsolete | — | — |
| [CWE-727](https://cwe.mitre.org/data/definitions/727.html) | OWASP Top Ten 2004 Category A6 - Injection Flaws | Obsolete | — | — |
| [CWE-728](https://cwe.mitre.org/data/definitions/728.html) | OWASP Top Ten 2004 Category A7 - Improper Error Handling | Obsolete | — | — |
| [CWE-729](https://cwe.mitre.org/data/definitions/729.html) | OWASP Top Ten 2004 Category A8 - Insecure Storage | Obsolete | — | — |
| [CWE-730](https://cwe.mitre.org/data/definitions/730.html) | OWASP Top Ten 2004 Category A9 - Denial of Service | Obsolete | — | — |
| [CWE-731](https://cwe.mitre.org/data/definitions/731.html) | OWASP Top Ten 2004 Category A10 - Insecure Configuration Management | Obsolete | — | — |
| [CWE-735](https://cwe.mitre.org/data/definitions/735.html) | CERT C Secure Coding Standard (2008) Chapter 2 - Preprocessor (PRE) | Obsolete | — | — |
| [CWE-736](https://cwe.mitre.org/data/definitions/736.html) | CERT C Secure Coding Standard (2008) Chapter 3 - Declarations and Initialization (DCL) | Obsolete | — | — |
| [CWE-737](https://cwe.mitre.org/data/definitions/737.html) | CERT C Secure Coding Standard (2008) Chapter 4 - Expressions (EXP) | Obsolete | — | — |
| [CWE-738](https://cwe.mitre.org/data/definitions/738.html) | CERT C Secure Coding Standard (2008) Chapter 5 - Integers (INT) | Obsolete | — | — |
| [CWE-739](https://cwe.mitre.org/data/definitions/739.html) | CERT C Secure Coding Standard (2008) Chapter 6 - Floating Point (FLP) | Obsolete | — | — |
| [CWE-740](https://cwe.mitre.org/data/definitions/740.html) | CERT C Secure Coding Standard (2008) Chapter 7 - Arrays (ARR) | Obsolete | — | — |
| [CWE-741](https://cwe.mitre.org/data/definitions/741.html) | CERT C Secure Coding Standard (2008) Chapter 8 - Characters and Strings (STR) | Obsolete | — | — |
| [CWE-742](https://cwe.mitre.org/data/definitions/742.html) | CERT C Secure Coding Standard (2008) Chapter 9 - Memory Management (MEM) | Obsolete | — | — |
| [CWE-743](https://cwe.mitre.org/data/definitions/743.html) | CERT C Secure Coding Standard (2008) Chapter 10 - Input Output (FIO) | Obsolete | — | — |
| [CWE-744](https://cwe.mitre.org/data/definitions/744.html) | CERT C Secure Coding Standard (2008) Chapter 11 - Environment (ENV) | Obsolete | — | — |
| [CWE-745](https://cwe.mitre.org/data/definitions/745.html) | CERT C Secure Coding Standard (2008) Chapter 12 - Signals (SIG) | Obsolete | — | — |
| [CWE-746](https://cwe.mitre.org/data/definitions/746.html) | CERT C Secure Coding Standard (2008) Chapter 13 - Error Handling (ERR) | Obsolete | — | — |
| [CWE-747](https://cwe.mitre.org/data/definitions/747.html) | CERT C Secure Coding Standard (2008) Chapter 14 - Miscellaneous (MSC) | Obsolete | — | — |
| [CWE-748](https://cwe.mitre.org/data/definitions/748.html) | CERT C Secure Coding Standard (2008) Appendix - POSIX (POS) | Obsolete | — | — |
| [CWE-751](https://cwe.mitre.org/data/definitions/751.html) | 2009 Top 25 - Insecure Interaction Between Components | Obsolete | — | — |
| [CWE-752](https://cwe.mitre.org/data/definitions/752.html) | 2009 Top 25 - Risky Resource Management | Obsolete | — | — |
| [CWE-753](https://cwe.mitre.org/data/definitions/753.html) | 2009 Top 25 - Porous Defenses | Obsolete | — | — |
| [CWE-801](https://cwe.mitre.org/data/definitions/801.html) | 2010 Top 25 - Insecure Interaction Between Components | Obsolete | — | — |
| [CWE-802](https://cwe.mitre.org/data/definitions/802.html) | 2010 Top 25 - Risky Resource Management | Obsolete | — | — |
| [CWE-803](https://cwe.mitre.org/data/definitions/803.html) | 2010 Top 25 - Porous Defenses | Obsolete | — | — |
| [CWE-808](https://cwe.mitre.org/data/definitions/808.html) | 2010 Top 25 - Weaknesses On the Cusp | Obsolete | — | — |
| [CWE-810](https://cwe.mitre.org/data/definitions/810.html) | OWASP Top Ten 2010 Category A1 - Injection | Obsolete | — | — |
| [CWE-811](https://cwe.mitre.org/data/definitions/811.html) | OWASP Top Ten 2010 Category A2 - Cross-Site Scripting (XSS) | Obsolete | — | — |
| [CWE-812](https://cwe.mitre.org/data/definitions/812.html) | OWASP Top Ten 2010 Category A3 - Broken Authentication and Session Management | Obsolete | — | — |
| [CWE-813](https://cwe.mitre.org/data/definitions/813.html) | OWASP Top Ten 2010 Category A4 - Insecure Direct Object References | Obsolete | — | — |
| [CWE-814](https://cwe.mitre.org/data/definitions/814.html) | OWASP Top Ten 2010 Category A5 - Cross-Site Request Forgery(CSRF) | Obsolete | — | — |
| [CWE-815](https://cwe.mitre.org/data/definitions/815.html) | OWASP Top Ten 2010 Category A6 - Security Misconfiguration | Obsolete | — | — |
| [CWE-816](https://cwe.mitre.org/data/definitions/816.html) | OWASP Top Ten 2010 Category A7 - Insecure Cryptographic Storage | Obsolete | — | — |
| [CWE-817](https://cwe.mitre.org/data/definitions/817.html) | OWASP Top Ten 2010 Category A8 - Failure to Restrict URL Access | Obsolete | — | — |
| [CWE-818](https://cwe.mitre.org/data/definitions/818.html) | OWASP Top Ten 2010 Category A9 - Insufficient Transport Layer Protection | Obsolete | — | — |
| [CWE-819](https://cwe.mitre.org/data/definitions/819.html) | OWASP Top Ten 2010 Category A10 - Unvalidated Redirects and Forwards | Obsolete | — | — |
| [CWE-840](https://cwe.mitre.org/data/definitions/840.html) | Business Logic Errors | Incomplete | — | — |
| [CWE-845](https://cwe.mitre.org/data/definitions/845.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 2 - Input Validation and Data Sanitization (IDS) | Obsolete | — | — |
| [CWE-846](https://cwe.mitre.org/data/definitions/846.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 3 - Declarations and Initialization (DCL) | Obsolete | — | — |
| [CWE-847](https://cwe.mitre.org/data/definitions/847.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 4 - Expressions (EXP) | Obsolete | — | — |
| [CWE-848](https://cwe.mitre.org/data/definitions/848.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 5 - Numeric Types and Operations (NUM) | Obsolete | — | — |
| [CWE-849](https://cwe.mitre.org/data/definitions/849.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 6 - Object Orientation (OBJ) | Obsolete | — | — |
| [CWE-850](https://cwe.mitre.org/data/definitions/850.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 7 - Methods (MET) | Obsolete | — | — |
| [CWE-851](https://cwe.mitre.org/data/definitions/851.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 8 - Exceptional Behavior (ERR) | Obsolete | — | — |
| [CWE-852](https://cwe.mitre.org/data/definitions/852.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 9 - Visibility and Atomicity (VNA) | Obsolete | — | — |
| [CWE-853](https://cwe.mitre.org/data/definitions/853.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 10 - Locking (LCK) | Obsolete | — | — |
| [CWE-854](https://cwe.mitre.org/data/definitions/854.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 11 - Thread APIs (THI) | Obsolete | — | — |
| [CWE-855](https://cwe.mitre.org/data/definitions/855.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 12 - Thread Pools (TPS) | Obsolete | — | — |
| [CWE-856](https://cwe.mitre.org/data/definitions/856.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 13 - Thread-Safety Miscellaneous (TSM) | Obsolete | — | — |
| [CWE-857](https://cwe.mitre.org/data/definitions/857.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 14 - Input Output (FIO) | Obsolete | — | — |
| [CWE-858](https://cwe.mitre.org/data/definitions/858.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 15 - Serialization (SER) | Obsolete | — | — |
| [CWE-859](https://cwe.mitre.org/data/definitions/859.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 16 - Platform Security (SEC) | Obsolete | — | — |
| [CWE-860](https://cwe.mitre.org/data/definitions/860.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 17 - Runtime Environment (ENV) | Obsolete | — | — |
| [CWE-861](https://cwe.mitre.org/data/definitions/861.html) | The CERT Oracle Secure Coding Standard for Java (2011) Chapter 18 - Miscellaneous (MSC) | Obsolete | — | — |
| [CWE-864](https://cwe.mitre.org/data/definitions/864.html) | 2011 Top 25 - Insecure Interaction Between Components | Obsolete | — | — |
| [CWE-865](https://cwe.mitre.org/data/definitions/865.html) | 2011 Top 25 - Risky Resource Management | Obsolete | — | — |
| [CWE-866](https://cwe.mitre.org/data/definitions/866.html) | 2011 Top 25 - Porous Defenses | Obsolete | — | — |
| [CWE-867](https://cwe.mitre.org/data/definitions/867.html) | 2011 Top 25 - Weaknesses On the Cusp | Obsolete | — | — |
| [CWE-869](https://cwe.mitre.org/data/definitions/869.html) | CERT C++ Secure Coding Section 01 - Preprocessor (PRE) | Incomplete | — | — |
| [CWE-870](https://cwe.mitre.org/data/definitions/870.html) | CERT C++ Secure Coding Section 02 - Declarations and Initialization (DCL) | Incomplete | — | — |
| [CWE-871](https://cwe.mitre.org/data/definitions/871.html) | CERT C++ Secure Coding Section 03 - Expressions (EXP) | Incomplete | — | — |
| [CWE-872](https://cwe.mitre.org/data/definitions/872.html) | CERT C++ Secure Coding Section 04 - Integers (INT) | Incomplete | — | — |
| [CWE-873](https://cwe.mitre.org/data/definitions/873.html) | CERT C++ Secure Coding Section 05 - Floating Point Arithmetic (FLP) | Incomplete | — | — |
| [CWE-874](https://cwe.mitre.org/data/definitions/874.html) | CERT C++ Secure Coding Section 06 - Arrays and the STL (ARR) | Incomplete | — | — |
| [CWE-875](https://cwe.mitre.org/data/definitions/875.html) | CERT C++ Secure Coding Section 07 - Characters and Strings (STR) | Incomplete | — | — |
| [CWE-876](https://cwe.mitre.org/data/definitions/876.html) | CERT C++ Secure Coding Section 08 - Memory Management (MEM) | Incomplete | — | — |
| [CWE-877](https://cwe.mitre.org/data/definitions/877.html) | CERT C++ Secure Coding Section 09 - Input Output (FIO) | Incomplete | — | — |
| [CWE-878](https://cwe.mitre.org/data/definitions/878.html) | CERT C++ Secure Coding Section 10 - Environment (ENV) | Incomplete | — | — |
| [CWE-879](https://cwe.mitre.org/data/definitions/879.html) | CERT C++ Secure Coding Section 11 - Signals (SIG) | Incomplete | — | — |
| [CWE-880](https://cwe.mitre.org/data/definitions/880.html) | CERT C++ Secure Coding Section 12 - Exceptions and Error Handling (ERR) | Incomplete | — | — |
| [CWE-881](https://cwe.mitre.org/data/definitions/881.html) | CERT C++ Secure Coding Section 13 - Object Oriented Programming (OOP) | Incomplete | — | — |
| [CWE-882](https://cwe.mitre.org/data/definitions/882.html) | CERT C++ Secure Coding Section 14 - Concurrency (CON) | Incomplete | — | — |
| [CWE-883](https://cwe.mitre.org/data/definitions/883.html) | CERT C++ Secure Coding Section 49 - Miscellaneous (MSC) | Incomplete | — | — |
| [CWE-885](https://cwe.mitre.org/data/definitions/885.html) | SFP Primary Cluster: Risky Values | Incomplete | — | — |
| [CWE-886](https://cwe.mitre.org/data/definitions/886.html) | SFP Primary Cluster: Unused entities | Incomplete | — | — |
| [CWE-887](https://cwe.mitre.org/data/definitions/887.html) | SFP Primary Cluster: API | Incomplete | — | — |
| [CWE-889](https://cwe.mitre.org/data/definitions/889.html) | SFP Primary Cluster: Exception Management | Incomplete | — | — |
| [CWE-890](https://cwe.mitre.org/data/definitions/890.html) | SFP Primary Cluster: Memory Access | Incomplete | — | — |
| [CWE-891](https://cwe.mitre.org/data/definitions/891.html) | SFP Primary Cluster: Memory Management | Incomplete | — | — |
| [CWE-892](https://cwe.mitre.org/data/definitions/892.html) | SFP Primary Cluster: Resource Management | Incomplete | — | — |
| [CWE-893](https://cwe.mitre.org/data/definitions/893.html) | SFP Primary Cluster: Path Resolution | Incomplete | — | — |
| [CWE-894](https://cwe.mitre.org/data/definitions/894.html) | SFP Primary Cluster: Synchronization | Incomplete | — | — |
| [CWE-895](https://cwe.mitre.org/data/definitions/895.html) | SFP Primary Cluster: Information Leak | Incomplete | — | — |
| [CWE-896](https://cwe.mitre.org/data/definitions/896.html) | SFP Primary Cluster: Tainted Input | Incomplete | — | — |
| [CWE-897](https://cwe.mitre.org/data/definitions/897.html) | SFP Primary Cluster: Entry Points | Incomplete | — | — |
| [CWE-898](https://cwe.mitre.org/data/definitions/898.html) | SFP Primary Cluster: Authentication | Incomplete | — | — |
| [CWE-899](https://cwe.mitre.org/data/definitions/899.html) | SFP Primary Cluster: Access Control | Incomplete | — | — |
| [CWE-901](https://cwe.mitre.org/data/definitions/901.html) | SFP Primary Cluster: Privilege | Incomplete | — | — |
| [CWE-902](https://cwe.mitre.org/data/definitions/902.html) | SFP Primary Cluster: Channel | Incomplete | — | — |
| [CWE-903](https://cwe.mitre.org/data/definitions/903.html) | SFP Primary Cluster: Cryptography | Incomplete | — | — |
| [CWE-904](https://cwe.mitre.org/data/definitions/904.html) | SFP Primary Cluster: Malware | Incomplete | — | — |
| [CWE-905](https://cwe.mitre.org/data/definitions/905.html) | SFP Primary Cluster: Predictability | Incomplete | — | — |
| [CWE-906](https://cwe.mitre.org/data/definitions/906.html) | SFP Primary Cluster: UI | Incomplete | — | — |
| [CWE-907](https://cwe.mitre.org/data/definitions/907.html) | SFP Primary Cluster: Other | Incomplete | — | — |
| [CWE-929](https://cwe.mitre.org/data/definitions/929.html) | OWASP Top Ten 2013 Category A1 - Injection | Obsolete | — | — |
| [CWE-930](https://cwe.mitre.org/data/definitions/930.html) | OWASP Top Ten 2013 Category A2 - Broken Authentication and Session Management | Obsolete | — | — |
| [CWE-931](https://cwe.mitre.org/data/definitions/931.html) | OWASP Top Ten 2013 Category A3 - Cross-Site Scripting (XSS) | Obsolete | — | — |
| [CWE-932](https://cwe.mitre.org/data/definitions/932.html) | OWASP Top Ten 2013 Category A4 - Insecure Direct Object References | Obsolete | — | — |
| [CWE-933](https://cwe.mitre.org/data/definitions/933.html) | OWASP Top Ten 2013 Category A5 - Security Misconfiguration | Obsolete | — | — |
| [CWE-934](https://cwe.mitre.org/data/definitions/934.html) | OWASP Top Ten 2013 Category A6 - Sensitive Data Exposure | Obsolete | — | — |
| [CWE-935](https://cwe.mitre.org/data/definitions/935.html) | OWASP Top Ten 2013 Category A7 - Missing Function Level Access Control | Obsolete | — | — |
| [CWE-936](https://cwe.mitre.org/data/definitions/936.html) | OWASP Top Ten 2013 Category A8 - Cross-Site Request Forgery (CSRF) | Obsolete | — | — |
| [CWE-937](https://cwe.mitre.org/data/definitions/937.html) | OWASP Top Ten 2013 Category A9 - Using Components with Known Vulnerabilities | Obsolete | — | — |
| [CWE-938](https://cwe.mitre.org/data/definitions/938.html) | OWASP Top Ten 2013 Category A10 - Unvalidated Redirects and Forwards | Obsolete | — | — |
| [CWE-944](https://cwe.mitre.org/data/definitions/944.html) | SFP Secondary Cluster: Access Management | Incomplete | — | — |
| [CWE-945](https://cwe.mitre.org/data/definitions/945.html) | SFP Secondary Cluster: Insecure Resource Access | Incomplete | — | — |
| [CWE-946](https://cwe.mitre.org/data/definitions/946.html) | SFP Secondary Cluster: Insecure Resource Permissions | Incomplete | — | — |
| [CWE-947](https://cwe.mitre.org/data/definitions/947.html) | SFP Secondary Cluster: Authentication Bypass | Incomplete | — | — |
| [CWE-948](https://cwe.mitre.org/data/definitions/948.html) | SFP Secondary Cluster: Digital Certificate | Incomplete | — | — |
| [CWE-949](https://cwe.mitre.org/data/definitions/949.html) | SFP Secondary Cluster: Faulty Endpoint Authentication | Incomplete | — | — |
| [CWE-950](https://cwe.mitre.org/data/definitions/950.html) | SFP Secondary Cluster: Hardcoded Sensitive Data | Incomplete | — | — |
| [CWE-951](https://cwe.mitre.org/data/definitions/951.html) | SFP Secondary Cluster: Insecure Authentication Policy | Incomplete | — | — |
| [CWE-952](https://cwe.mitre.org/data/definitions/952.html) | SFP Secondary Cluster: Missing Authentication | Incomplete | — | — |
| [CWE-953](https://cwe.mitre.org/data/definitions/953.html) | SFP Secondary Cluster: Missing Endpoint Authentication | Incomplete | — | — |
| [CWE-954](https://cwe.mitre.org/data/definitions/954.html) | SFP Secondary Cluster: Multiple Binds to the Same Port | Incomplete | — | — |
| [CWE-955](https://cwe.mitre.org/data/definitions/955.html) | SFP Secondary Cluster: Unrestricted Authentication | Incomplete | — | — |
| [CWE-956](https://cwe.mitre.org/data/definitions/956.html) | SFP Secondary Cluster: Channel Attack | Incomplete | — | — |
| [CWE-957](https://cwe.mitre.org/data/definitions/957.html) | SFP Secondary Cluster: Protocol Error | Incomplete | — | — |
| [CWE-958](https://cwe.mitre.org/data/definitions/958.html) | SFP Secondary Cluster: Broken Cryptography | Incomplete | — | — |
| [CWE-959](https://cwe.mitre.org/data/definitions/959.html) | SFP Secondary Cluster: Weak Cryptography | Incomplete | — | — |
| [CWE-960](https://cwe.mitre.org/data/definitions/960.html) | SFP Secondary Cluster: Ambiguous Exception Type | Incomplete | — | — |
| [CWE-961](https://cwe.mitre.org/data/definitions/961.html) | SFP Secondary Cluster: Incorrect Exception Behavior | Incomplete | — | — |
| [CWE-962](https://cwe.mitre.org/data/definitions/962.html) | SFP Secondary Cluster: Unchecked Status Condition | Incomplete | — | — |
| [CWE-963](https://cwe.mitre.org/data/definitions/963.html) | SFP Secondary Cluster: Exposed Data | Incomplete | — | — |
| [CWE-964](https://cwe.mitre.org/data/definitions/964.html) | SFP Secondary Cluster: Exposure Temporary File | Incomplete | — | — |
| [CWE-965](https://cwe.mitre.org/data/definitions/965.html) | SFP Secondary Cluster: Insecure Session Management | Incomplete | — | — |
| [CWE-966](https://cwe.mitre.org/data/definitions/966.html) | SFP Secondary Cluster: Other Exposures | Incomplete | — | — |
| [CWE-967](https://cwe.mitre.org/data/definitions/967.html) | SFP Secondary Cluster: State Disclosure | Incomplete | — | — |
| [CWE-968](https://cwe.mitre.org/data/definitions/968.html) | SFP Secondary Cluster: Covert Channel | Incomplete | — | — |
| [CWE-969](https://cwe.mitre.org/data/definitions/969.html) | SFP Secondary Cluster: Faulty Memory Release | Incomplete | — | — |
| [CWE-970](https://cwe.mitre.org/data/definitions/970.html) | SFP Secondary Cluster: Faulty Buffer Access | Incomplete | — | — |
| [CWE-971](https://cwe.mitre.org/data/definitions/971.html) | SFP Secondary Cluster: Faulty Pointer Use | Incomplete | — | — |
| [CWE-972](https://cwe.mitre.org/data/definitions/972.html) | SFP Secondary Cluster: Faulty String Expansion | Incomplete | — | — |
| [CWE-973](https://cwe.mitre.org/data/definitions/973.html) | SFP Secondary Cluster: Improper NULL Termination | Incomplete | — | — |
| [CWE-974](https://cwe.mitre.org/data/definitions/974.html) | SFP Secondary Cluster: Incorrect Buffer Length Computation | Incomplete | — | — |
| [CWE-975](https://cwe.mitre.org/data/definitions/975.html) | SFP Secondary Cluster: Architecture | Incomplete | — | — |
| [CWE-976](https://cwe.mitre.org/data/definitions/976.html) | SFP Secondary Cluster: Compiler | Incomplete | — | — |
| [CWE-977](https://cwe.mitre.org/data/definitions/977.html) | SFP Secondary Cluster: Design | Incomplete | — | — |
| [CWE-978](https://cwe.mitre.org/data/definitions/978.html) | SFP Secondary Cluster: Implementation | Incomplete | — | — |
| [CWE-979](https://cwe.mitre.org/data/definitions/979.html) | SFP Secondary Cluster: Failed Chroot Jail | Incomplete | — | — |
| [CWE-980](https://cwe.mitre.org/data/definitions/980.html) | SFP Secondary Cluster: Link in Resource Name Resolution | Incomplete | — | — |
| [CWE-981](https://cwe.mitre.org/data/definitions/981.html) | SFP Secondary Cluster: Path Traversal | Incomplete | — | — |
| [CWE-982](https://cwe.mitre.org/data/definitions/982.html) | SFP Secondary Cluster: Failure to Release Resource | Incomplete | — | — |
| [CWE-983](https://cwe.mitre.org/data/definitions/983.html) | SFP Secondary Cluster: Faulty Resource Use | Incomplete | — | — |
| [CWE-984](https://cwe.mitre.org/data/definitions/984.html) | SFP Secondary Cluster: Life Cycle | Incomplete | — | — |
| [CWE-985](https://cwe.mitre.org/data/definitions/985.html) | SFP Secondary Cluster: Unrestricted Consumption | Incomplete | — | — |
| [CWE-986](https://cwe.mitre.org/data/definitions/986.html) | SFP Secondary Cluster: Missing Lock | Incomplete | — | — |
| [CWE-987](https://cwe.mitre.org/data/definitions/987.html) | SFP Secondary Cluster: Multiple Locks/Unlocks | Incomplete | — | — |
| [CWE-988](https://cwe.mitre.org/data/definitions/988.html) | SFP Secondary Cluster: Race Condition Window | Incomplete | — | — |
| [CWE-989](https://cwe.mitre.org/data/definitions/989.html) | SFP Secondary Cluster: Unrestricted Lock | Incomplete | — | — |
| [CWE-990](https://cwe.mitre.org/data/definitions/990.html) | SFP Secondary Cluster: Tainted Input to Command | Incomplete | — | — |
| [CWE-991](https://cwe.mitre.org/data/definitions/991.html) | SFP Secondary Cluster: Tainted Input to Environment | Incomplete | — | — |
| [CWE-992](https://cwe.mitre.org/data/definitions/992.html) | SFP Secondary Cluster: Faulty Input Transformation | Incomplete | — | — |
| [CWE-993](https://cwe.mitre.org/data/definitions/993.html) | SFP Secondary Cluster: Incorrect Input Handling | Incomplete | — | — |
| [CWE-994](https://cwe.mitre.org/data/definitions/994.html) | SFP Secondary Cluster: Tainted Input to Variable | Incomplete | — | — |
| [CWE-995](https://cwe.mitre.org/data/definitions/995.html) | SFP Secondary Cluster: Feature | Incomplete | — | — |
| [CWE-996](https://cwe.mitre.org/data/definitions/996.html) | SFP Secondary Cluster: Security | Incomplete | — | — |
| [CWE-997](https://cwe.mitre.org/data/definitions/997.html) | SFP Secondary Cluster: Information Loss | Incomplete | — | — |
| [CWE-998](https://cwe.mitre.org/data/definitions/998.html) | SFP Secondary Cluster: Glitch in Computation | Incomplete | — | — |
| [CWE-1001](https://cwe.mitre.org/data/definitions/1001.html) | SFP Secondary Cluster: Use of an Improper API | Incomplete | — | — |
| [CWE-1002](https://cwe.mitre.org/data/definitions/1002.html) | SFP Secondary Cluster: Unexpected Entry Points | Incomplete | — | — |
| [CWE-1005](https://cwe.mitre.org/data/definitions/1005.html) | 7PK - Input Validation and Representation | Draft | — | — |
| [CWE-1006](https://cwe.mitre.org/data/definitions/1006.html) | Bad Coding Practices | Draft | — | — |
| [CWE-1009](https://cwe.mitre.org/data/definitions/1009.html) | Audit | Draft | — | — |
| [CWE-1010](https://cwe.mitre.org/data/definitions/1010.html) | Authenticate Actors | Draft | — | — |
| [CWE-1011](https://cwe.mitre.org/data/definitions/1011.html) | Authorize Actors | Draft | — | — |
| [CWE-1012](https://cwe.mitre.org/data/definitions/1012.html) | Cross Cutting | Draft | — | — |
| [CWE-1013](https://cwe.mitre.org/data/definitions/1013.html) | Encrypt Data | Draft | — | — |
| [CWE-1014](https://cwe.mitre.org/data/definitions/1014.html) | Identify Actors | Draft | — | — |
| [CWE-1015](https://cwe.mitre.org/data/definitions/1015.html) | Limit Access | Draft | — | — |
| [CWE-1016](https://cwe.mitre.org/data/definitions/1016.html) | Limit Exposure | Draft | — | — |
| [CWE-1017](https://cwe.mitre.org/data/definitions/1017.html) | Lock Computer | Draft | — | — |
| [CWE-1018](https://cwe.mitre.org/data/definitions/1018.html) | Manage User Sessions | Draft | — | — |
| [CWE-1019](https://cwe.mitre.org/data/definitions/1019.html) | Validate Inputs | Draft | — | — |
| [CWE-1020](https://cwe.mitre.org/data/definitions/1020.html) | Verify Message Integrity | Draft | — | — |
| [CWE-1027](https://cwe.mitre.org/data/definitions/1027.html) | OWASP Top Ten 2017 Category A1 - Injection | Incomplete | — | — |
| [CWE-1028](https://cwe.mitre.org/data/definitions/1028.html) | OWASP Top Ten 2017 Category A2 - Broken Authentication | Incomplete | — | — |
| [CWE-1029](https://cwe.mitre.org/data/definitions/1029.html) | OWASP Top Ten 2017 Category A3 - Sensitive Data Exposure | Incomplete | — | — |
| [CWE-1030](https://cwe.mitre.org/data/definitions/1030.html) | OWASP Top Ten 2017 Category A4 - XML External Entities (XXE) | Incomplete | — | — |
| [CWE-1031](https://cwe.mitre.org/data/definitions/1031.html) | OWASP Top Ten 2017 Category A5 - Broken Access Control | Incomplete | — | — |
| [CWE-1032](https://cwe.mitre.org/data/definitions/1032.html) | OWASP Top Ten 2017 Category A6 - Security Misconfiguration | Incomplete | — | — |
| [CWE-1033](https://cwe.mitre.org/data/definitions/1033.html) | OWASP Top Ten 2017 Category A7 - Cross-Site Scripting (XSS) | Incomplete | — | — |
| [CWE-1034](https://cwe.mitre.org/data/definitions/1034.html) | OWASP Top Ten 2017 Category A8 - Insecure Deserialization | Incomplete | — | — |
| [CWE-1035](https://cwe.mitre.org/data/definitions/1035.html) | OWASP Top Ten 2017 Category A9 - Using Components with Known Vulnerabilities | Incomplete | — | — |
| [CWE-1036](https://cwe.mitre.org/data/definitions/1036.html) | OWASP Top Ten 2017 Category A10 - Insufficient Logging & Monitoring | Incomplete | — | — |
| [CWE-1129](https://cwe.mitre.org/data/definitions/1129.html) | CISQ Quality Measures (2016) - Reliability | Draft | — | — |
| [CWE-1130](https://cwe.mitre.org/data/definitions/1130.html) | CISQ Quality Measures (2016) - Maintainability | Draft | — | — |
| [CWE-1131](https://cwe.mitre.org/data/definitions/1131.html) | CISQ Quality Measures (2016) - Security | Draft | — | — |
| [CWE-1132](https://cwe.mitre.org/data/definitions/1132.html) | CISQ Quality Measures (2016) - Performance Efficiency | Draft | — | — |
| [CWE-1134](https://cwe.mitre.org/data/definitions/1134.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 00. Input Validation and Data Sanitization (IDS) | Stable | — | — |
| [CWE-1135](https://cwe.mitre.org/data/definitions/1135.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 01. Declarations and Initialization (DCL) | Stable | — | — |
| [CWE-1136](https://cwe.mitre.org/data/definitions/1136.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 02. Expressions (EXP) | Stable | — | — |
| [CWE-1137](https://cwe.mitre.org/data/definitions/1137.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 03. Numeric Types and Operations (NUM) | Stable | — | — |
| [CWE-1138](https://cwe.mitre.org/data/definitions/1138.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 04. Characters and Strings (STR) | Stable | — | — |
| [CWE-1139](https://cwe.mitre.org/data/definitions/1139.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 05. Object Orientation (OBJ) | Stable | — | — |
| [CWE-1140](https://cwe.mitre.org/data/definitions/1140.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 06. Methods (MET) | Stable | — | — |
| [CWE-1141](https://cwe.mitre.org/data/definitions/1141.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 07. Exceptional Behavior (ERR) | Stable | — | — |
| [CWE-1142](https://cwe.mitre.org/data/definitions/1142.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 08. Visibility and Atomicity (VNA) | Stable | — | — |
| [CWE-1143](https://cwe.mitre.org/data/definitions/1143.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 09. Locking (LCK) | Stable | — | — |
| [CWE-1144](https://cwe.mitre.org/data/definitions/1144.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 10. Thread APIs (THI) | Stable | — | — |
| [CWE-1145](https://cwe.mitre.org/data/definitions/1145.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 11. Thread Pools (TPS) | Stable | — | — |
| [CWE-1146](https://cwe.mitre.org/data/definitions/1146.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 12. Thread-Safety Miscellaneous (TSM) | Stable | — | — |
| [CWE-1147](https://cwe.mitre.org/data/definitions/1147.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 13. Input Output (FIO) | Stable | — | — |
| [CWE-1148](https://cwe.mitre.org/data/definitions/1148.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 14. Serialization (SER) | Stable | — | — |
| [CWE-1149](https://cwe.mitre.org/data/definitions/1149.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 15. Platform Security (SEC) | Stable | — | — |
| [CWE-1150](https://cwe.mitre.org/data/definitions/1150.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 16. Runtime Environment (ENV) | Stable | — | — |
| [CWE-1151](https://cwe.mitre.org/data/definitions/1151.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 17. Java Native Interface (JNI) | Stable | — | — |
| [CWE-1152](https://cwe.mitre.org/data/definitions/1152.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 49. Miscellaneous (MSC) | Stable | — | — |
| [CWE-1153](https://cwe.mitre.org/data/definitions/1153.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 50. Android (DRD) | Stable | — | — |
| [CWE-1155](https://cwe.mitre.org/data/definitions/1155.html) | SEI CERT C Coding Standard - Guidelines 01. Preprocessor (PRE) | Stable | — | — |
| [CWE-1156](https://cwe.mitre.org/data/definitions/1156.html) | SEI CERT C Coding Standard - Guidelines 02. Declarations and Initialization (DCL) | Stable | — | — |
| [CWE-1157](https://cwe.mitre.org/data/definitions/1157.html) | SEI CERT C Coding Standard - Guidelines 03. Expressions (EXP) | Stable | — | — |
| [CWE-1158](https://cwe.mitre.org/data/definitions/1158.html) | SEI CERT C Coding Standard - Guidelines 04. Integers (INT) | Stable | — | — |
| [CWE-1159](https://cwe.mitre.org/data/definitions/1159.html) | SEI CERT C Coding Standard - Guidelines 05. Floating Point (FLP) | Stable | — | — |
| [CWE-1160](https://cwe.mitre.org/data/definitions/1160.html) | SEI CERT C Coding Standard - Guidelines 06. Arrays (ARR) | Stable | — | — |
| [CWE-1161](https://cwe.mitre.org/data/definitions/1161.html) | SEI CERT C Coding Standard - Guidelines 07. Characters and Strings (STR) | Stable | — | — |
| [CWE-1162](https://cwe.mitre.org/data/definitions/1162.html) | SEI CERT C Coding Standard - Guidelines 08. Memory Management (MEM) | Stable | — | — |
| [CWE-1163](https://cwe.mitre.org/data/definitions/1163.html) | SEI CERT C Coding Standard - Guidelines 09. Input Output (FIO) | Stable | — | — |
| [CWE-1165](https://cwe.mitre.org/data/definitions/1165.html) | SEI CERT C Coding Standard - Guidelines 10. Environment (ENV) | Stable | — | — |
| [CWE-1166](https://cwe.mitre.org/data/definitions/1166.html) | SEI CERT C Coding Standard - Guidelines 11. Signals (SIG) | Stable | — | — |
| [CWE-1167](https://cwe.mitre.org/data/definitions/1167.html) | SEI CERT C Coding Standard - Guidelines 12. Error Handling (ERR) | Stable | — | — |
| [CWE-1168](https://cwe.mitre.org/data/definitions/1168.html) | SEI CERT C Coding Standard - Guidelines 13. Application Programming Interfaces (API) | Stable | — | — |
| [CWE-1169](https://cwe.mitre.org/data/definitions/1169.html) | SEI CERT C Coding Standard - Guidelines 14. Concurrency (CON) | Stable | — | — |
| [CWE-1170](https://cwe.mitre.org/data/definitions/1170.html) | SEI CERT C Coding Standard - Guidelines 48. Miscellaneous (MSC) | Stable | — | — |
| [CWE-1171](https://cwe.mitre.org/data/definitions/1171.html) | SEI CERT C Coding Standard - Guidelines 50. POSIX (POS) | Stable | — | — |
| [CWE-1172](https://cwe.mitre.org/data/definitions/1172.html) | SEI CERT C Coding Standard - Guidelines 51. Microsoft Windows (WIN) | Stable | — | — |
| [CWE-1175](https://cwe.mitre.org/data/definitions/1175.html) | SEI CERT Oracle Secure Coding Standard for Java - Guidelines 18. Concurrency (CON) | Stable | — | — |
| [CWE-1179](https://cwe.mitre.org/data/definitions/1179.html) | SEI CERT Perl Coding Standard - Guidelines 01. Input Validation and Data Sanitization (IDS) | Stable | — | — |
| [CWE-1180](https://cwe.mitre.org/data/definitions/1180.html) | SEI CERT Perl Coding Standard - Guidelines 02. Declarations and Initialization (DCL) | Stable | — | — |
| [CWE-1181](https://cwe.mitre.org/data/definitions/1181.html) | SEI CERT Perl Coding Standard - Guidelines 03. Expressions (EXP) | Stable | — | — |
| [CWE-1182](https://cwe.mitre.org/data/definitions/1182.html) | SEI CERT Perl Coding Standard - Guidelines 04. Integers (INT) | Stable | — | — |
| [CWE-1183](https://cwe.mitre.org/data/definitions/1183.html) | SEI CERT Perl Coding Standard - Guidelines 05. Strings (STR) | Stable | — | — |
| [CWE-1184](https://cwe.mitre.org/data/definitions/1184.html) | SEI CERT Perl Coding Standard - Guidelines 06. Object-Oriented Programming (OOP) | Stable | — | — |
| [CWE-1185](https://cwe.mitre.org/data/definitions/1185.html) | SEI CERT Perl Coding Standard - Guidelines 07. File Input and Output (FIO) | Stable | — | — |
| [CWE-1186](https://cwe.mitre.org/data/definitions/1186.html) | SEI CERT Perl Coding Standard - Guidelines 50. Miscellaneous (MSC) | Stable | — | — |
| [CWE-1195](https://cwe.mitre.org/data/definitions/1195.html) | Manufacturing and Life Cycle Management Concerns | Draft | — | — |
| [CWE-1196](https://cwe.mitre.org/data/definitions/1196.html) | Security Flow Issues | Draft | — | — |
| [CWE-1197](https://cwe.mitre.org/data/definitions/1197.html) | Integration Issues | Draft | — | — |
| [CWE-1198](https://cwe.mitre.org/data/definitions/1198.html) | Privilege Separation and Access Control Issues | Draft | — | — |
| [CWE-1199](https://cwe.mitre.org/data/definitions/1199.html) | General Circuit and Logic Design Concerns | Draft | — | — |
| [CWE-1201](https://cwe.mitre.org/data/definitions/1201.html) | Core and Compute Issues | Draft | — | — |
| [CWE-1202](https://cwe.mitre.org/data/definitions/1202.html) | Memory and Storage Issues | Draft | — | — |
| [CWE-1203](https://cwe.mitre.org/data/definitions/1203.html) | Peripherals, On-chip Fabric, and Interface/IO Problems | Draft | — | — |
| [CWE-1205](https://cwe.mitre.org/data/definitions/1205.html) | Security Primitives and Cryptography Issues | Draft | — | — |
| [CWE-1206](https://cwe.mitre.org/data/definitions/1206.html) | Power, Clock, Thermal, and Reset Concerns | Draft | — | — |
| [CWE-1207](https://cwe.mitre.org/data/definitions/1207.html) | Debug and Test Problems | Draft | — | — |
| [CWE-1208](https://cwe.mitre.org/data/definitions/1208.html) | Cross-Cutting Problems | Draft | — | — |
| [CWE-1210](https://cwe.mitre.org/data/definitions/1210.html) | Audit / Logging Errors | Draft | — | — |
| [CWE-1211](https://cwe.mitre.org/data/definitions/1211.html) | Authentication Errors | Draft | — | — |
| [CWE-1212](https://cwe.mitre.org/data/definitions/1212.html) | Authorization Errors | Draft | — | — |
| [CWE-1213](https://cwe.mitre.org/data/definitions/1213.html) | Random Number Issues | Draft | — | — |
| [CWE-1214](https://cwe.mitre.org/data/definitions/1214.html) | Data Integrity Issues | Draft | — | — |
| [CWE-1215](https://cwe.mitre.org/data/definitions/1215.html) | Data Validation Issues | Draft | — | — |
| [CWE-1216](https://cwe.mitre.org/data/definitions/1216.html) | Lockout Mechanism Errors | Draft | — | — |
| [CWE-1217](https://cwe.mitre.org/data/definitions/1217.html) | User Session Errors | Draft | — | — |
| [CWE-1218](https://cwe.mitre.org/data/definitions/1218.html) | Memory Buffer Errors | Draft | — | — |
| [CWE-1219](https://cwe.mitre.org/data/definitions/1219.html) | File Handling Issues | Draft | — | — |
| [CWE-1225](https://cwe.mitre.org/data/definitions/1225.html) | Documentation Issues | Draft | — | — |
| [CWE-1226](https://cwe.mitre.org/data/definitions/1226.html) | Complexity Issues | Draft | — | — |
| [CWE-1227](https://cwe.mitre.org/data/definitions/1227.html) | Encapsulation Issues | Draft | — | — |
| [CWE-1228](https://cwe.mitre.org/data/definitions/1228.html) | API / Function Errors | Draft | — | — |
| [CWE-1237](https://cwe.mitre.org/data/definitions/1237.html) | SFP Primary Cluster: Faulty Resource Release | Incomplete | — | — |
| [CWE-1238](https://cwe.mitre.org/data/definitions/1238.html) | SFP Primary Cluster: Failure to Release Memory | Incomplete | — | — |
| [CWE-1306](https://cwe.mitre.org/data/definitions/1306.html) | CISQ Quality Measures - Reliability | Incomplete | — | — |
| [CWE-1307](https://cwe.mitre.org/data/definitions/1307.html) | CISQ Quality Measures - Maintainability | Incomplete | — | — |
| [CWE-1308](https://cwe.mitre.org/data/definitions/1308.html) | CISQ Quality Measures - Security | Incomplete | — | — |
| [CWE-1309](https://cwe.mitre.org/data/definitions/1309.html) | CISQ Quality Measures - Efficiency | Incomplete | — | — |
| [CWE-1345](https://cwe.mitre.org/data/definitions/1345.html) | OWASP Top Ten 2021 Category A01:2021 - Broken Access Control | Incomplete | — | — |
| [CWE-1346](https://cwe.mitre.org/data/definitions/1346.html) | OWASP Top Ten 2021 Category A02:2021 - Cryptographic Failures | Incomplete | — | — |
| [CWE-1347](https://cwe.mitre.org/data/definitions/1347.html) | OWASP Top Ten 2021 Category A03:2021 - Injection | Incomplete | — | — |
| [CWE-1348](https://cwe.mitre.org/data/definitions/1348.html) | OWASP Top Ten 2021 Category A04:2021 - Insecure Design | Incomplete | — | — |
| [CWE-1349](https://cwe.mitre.org/data/definitions/1349.html) | OWASP Top Ten 2021 Category A05:2021 - Security Misconfiguration | Incomplete | — | — |
| [CWE-1352](https://cwe.mitre.org/data/definitions/1352.html) | OWASP Top Ten 2021 Category A06:2021 - Vulnerable and Outdated Components | Incomplete | — | — |
| [CWE-1353](https://cwe.mitre.org/data/definitions/1353.html) | OWASP Top Ten 2021 Category A07:2021 - Identification and Authentication Failures | Incomplete | — | — |
| [CWE-1354](https://cwe.mitre.org/data/definitions/1354.html) | OWASP Top Ten 2021 Category A08:2021 - Software and Data Integrity Failures | Incomplete | — | — |
| [CWE-1355](https://cwe.mitre.org/data/definitions/1355.html) | OWASP Top Ten 2021 Category A09:2021 - Security Logging and Monitoring Failures | Incomplete | — | — |
| [CWE-1356](https://cwe.mitre.org/data/definitions/1356.html) | OWASP Top Ten 2021 Category A10:2021 - Server-Side Request Forgery (SSRF) | Incomplete | — | — |
| [CWE-1359](https://cwe.mitre.org/data/definitions/1359.html) | ICS Communications | Incomplete | — | — |
| [CWE-1360](https://cwe.mitre.org/data/definitions/1360.html) | ICS Dependencies (& Architecture) | Incomplete | — | — |
| [CWE-1361](https://cwe.mitre.org/data/definitions/1361.html) | ICS Supply Chain | Incomplete | — | — |
| [CWE-1362](https://cwe.mitre.org/data/definitions/1362.html) | ICS Engineering (Constructions/Deployment) | Incomplete | — | — |
| [CWE-1363](https://cwe.mitre.org/data/definitions/1363.html) | ICS Operations (& Maintenance) | Incomplete | — | — |
| [CWE-1364](https://cwe.mitre.org/data/definitions/1364.html) | ICS Communications: Zone Boundary Failures | Incomplete | — | — |
| [CWE-1365](https://cwe.mitre.org/data/definitions/1365.html) | ICS Communications: Unreliability | Incomplete | — | — |
| [CWE-1366](https://cwe.mitre.org/data/definitions/1366.html) | ICS Communications: Frail Security in Protocols | Incomplete | — | — |
| [CWE-1367](https://cwe.mitre.org/data/definitions/1367.html) | ICS Dependencies (& Architecture): External Physical Systems | Incomplete | — | — |
| [CWE-1368](https://cwe.mitre.org/data/definitions/1368.html) | ICS Dependencies (& Architecture): External Digital Systems | Incomplete | — | — |
| [CWE-1369](https://cwe.mitre.org/data/definitions/1369.html) | ICS Supply Chain: IT/OT Convergence/Expansion | Incomplete | — | — |
| [CWE-1370](https://cwe.mitre.org/data/definitions/1370.html) | ICS Supply Chain: Common Mode Frailties | Incomplete | — | — |
| [CWE-1371](https://cwe.mitre.org/data/definitions/1371.html) | ICS Supply Chain: Poorly Documented or Undocumented Features | Incomplete | — | — |
| [CWE-1372](https://cwe.mitre.org/data/definitions/1372.html) | ICS Supply Chain: OT Counterfeit and Malicious Corruption | Incomplete | — | — |
| [CWE-1373](https://cwe.mitre.org/data/definitions/1373.html) | ICS Engineering (Construction/Deployment): Trust Model Problems | Incomplete | — | — |
| [CWE-1374](https://cwe.mitre.org/data/definitions/1374.html) | ICS Engineering (Construction/Deployment): Maker Breaker Blindness | Incomplete | — | — |
| [CWE-1375](https://cwe.mitre.org/data/definitions/1375.html) | ICS Engineering (Construction/Deployment): Gaps in Details/Data | Incomplete | — | — |
| [CWE-1376](https://cwe.mitre.org/data/definitions/1376.html) | ICS Engineering (Construction/Deployment): Security Gaps in Commissioning | Incomplete | — | — |
| [CWE-1377](https://cwe.mitre.org/data/definitions/1377.html) | ICS Engineering (Construction/Deployment): Inherent Predictability in Design | Incomplete | — | — |
| [CWE-1378](https://cwe.mitre.org/data/definitions/1378.html) | ICS Operations (& Maintenance): Gaps in obligations and training | Incomplete | — | — |
| [CWE-1379](https://cwe.mitre.org/data/definitions/1379.html) | ICS Operations (& Maintenance): Human factors in ICS environments | Incomplete | — | — |
| [CWE-1380](https://cwe.mitre.org/data/definitions/1380.html) | ICS Operations (& Maintenance): Post-analysis changes | Incomplete | — | — |
| [CWE-1381](https://cwe.mitre.org/data/definitions/1381.html) | ICS Operations (& Maintenance): Exploitable Standard Operational Procedures | Incomplete | — | — |
| [CWE-1382](https://cwe.mitre.org/data/definitions/1382.html) | ICS Operations (& Maintenance): Emerging Energy Technologies | Incomplete | — | — |
| [CWE-1383](https://cwe.mitre.org/data/definitions/1383.html) | ICS Operations (& Maintenance): Compliance/Conformance with Regulatory Requirements | Incomplete | — | — |
| [CWE-1388](https://cwe.mitre.org/data/definitions/1388.html) | Physical Access Issues and Concerns | Draft | — | — |
| [CWE-1396](https://cwe.mitre.org/data/definitions/1396.html) | Comprehensive Categorization: Access Control | Incomplete | — | — |
| [CWE-1397](https://cwe.mitre.org/data/definitions/1397.html) | Comprehensive Categorization: Comparison | Incomplete | — | — |
| [CWE-1398](https://cwe.mitre.org/data/definitions/1398.html) | Comprehensive Categorization: Component Interaction | Incomplete | — | — |
| [CWE-1399](https://cwe.mitre.org/data/definitions/1399.html) | Comprehensive Categorization: Memory Safety | Incomplete | — | — |
| [CWE-1401](https://cwe.mitre.org/data/definitions/1401.html) | Comprehensive Categorization: Concurrency | Incomplete | — | — |
| [CWE-1402](https://cwe.mitre.org/data/definitions/1402.html) | Comprehensive Categorization: Encryption | Incomplete | — | — |
| [CWE-1403](https://cwe.mitre.org/data/definitions/1403.html) | Comprehensive Categorization: Exposed Resource | Incomplete | — | — |
| [CWE-1404](https://cwe.mitre.org/data/definitions/1404.html) | Comprehensive Categorization: File Handling | Incomplete | — | — |
| [CWE-1405](https://cwe.mitre.org/data/definitions/1405.html) | Comprehensive Categorization: Improper Check or Handling of Exceptional Conditions | Incomplete | — | — |
| [CWE-1406](https://cwe.mitre.org/data/definitions/1406.html) | Comprehensive Categorization: Improper Input Validation | Incomplete | — | — |
| [CWE-1407](https://cwe.mitre.org/data/definitions/1407.html) | Comprehensive Categorization: Improper Neutralization | Incomplete | — | — |
| [CWE-1408](https://cwe.mitre.org/data/definitions/1408.html) | Comprehensive Categorization: Incorrect Calculation | Incomplete | — | — |
| [CWE-1409](https://cwe.mitre.org/data/definitions/1409.html) | Comprehensive Categorization: Injection | Incomplete | — | — |
| [CWE-1410](https://cwe.mitre.org/data/definitions/1410.html) | Comprehensive Categorization: Insufficient Control Flow Management | Incomplete | — | — |
| [CWE-1411](https://cwe.mitre.org/data/definitions/1411.html) | Comprehensive Categorization: Insufficient Verification of Data Authenticity | Incomplete | — | — |
| [CWE-1412](https://cwe.mitre.org/data/definitions/1412.html) | Comprehensive Categorization: Poor Coding Practices | Incomplete | — | — |
| [CWE-1413](https://cwe.mitre.org/data/definitions/1413.html) | Comprehensive Categorization: Protection Mechanism Failure | Incomplete | — | — |
| [CWE-1414](https://cwe.mitre.org/data/definitions/1414.html) | Comprehensive Categorization: Randomness | Incomplete | — | — |
| [CWE-1415](https://cwe.mitre.org/data/definitions/1415.html) | Comprehensive Categorization: Resource Control | Incomplete | — | — |
| [CWE-1416](https://cwe.mitre.org/data/definitions/1416.html) | Comprehensive Categorization: Resource Lifecycle Management | Incomplete | — | — |
| [CWE-1417](https://cwe.mitre.org/data/definitions/1417.html) | Comprehensive Categorization: Sensitive Information Exposure | Incomplete | — | — |
| [CWE-1418](https://cwe.mitre.org/data/definitions/1418.html) | Comprehensive Categorization: Violation of Secure Design Principles | Incomplete | — | — |
| [CWE-1433](https://cwe.mitre.org/data/definitions/1433.html) | 2025 MIHW Supplement: Expert Insights | Obsolete | — | — |
| [CWE-1436](https://cwe.mitre.org/data/definitions/1436.html) | OWASP Top Ten 2025 Category A01:2025 - Broken Access Control | Incomplete | — | — |
| [CWE-1437](https://cwe.mitre.org/data/definitions/1437.html) | OWASP Top Ten 2025 Category A02:2025 - Security Misconfiguration | Incomplete | — | — |
| [CWE-1438](https://cwe.mitre.org/data/definitions/1438.html) | OWASP Top Ten 2025 Category A03:2025 - Software Supply Chain Failures | Incomplete | — | — |
| [CWE-1439](https://cwe.mitre.org/data/definitions/1439.html) | OWASP Top Ten 2025 Category A04:2025 - Cryptographic Failures | Incomplete | — | — |
| [CWE-1440](https://cwe.mitre.org/data/definitions/1440.html) | OWASP Top Ten 2025 Category A05:2025 - Injection | Incomplete | — | — |
| [CWE-1441](https://cwe.mitre.org/data/definitions/1441.html) | OWASP Top Ten 2025 Category A06:2025 - Insecure Design | Incomplete | — | — |
| [CWE-1442](https://cwe.mitre.org/data/definitions/1442.html) | OWASP Top Ten 2025 Category A07:2025 - Authentication Failures | Incomplete | — | — |
| [CWE-1443](https://cwe.mitre.org/data/definitions/1443.html) | OWASP Top Ten 2025 Category A08:2025 - Software or Data Integrity Failures | Incomplete | — | — |
| [CWE-1444](https://cwe.mitre.org/data/definitions/1444.html) | OWASP Top Ten 2025 Category A09:2025 - Logging & Alerting Failures | Incomplete | — | — |
| [CWE-1445](https://cwe.mitre.org/data/definitions/1445.html) | OWASP Top Ten 2025 Category A10:2025 - Mishandling of Exceptional Conditions | Incomplete | — | — |
| [CWE-1446](https://cwe.mitre.org/data/definitions/1446.html) | Weaknesses That are Specific to AI/ML Technology | Incomplete | — | — |
| [CWE-1447](https://cwe.mitre.org/data/definitions/1447.html) | General Software Weaknesses that Appear in Products that Use or Support AI/ML Technology | Incomplete | — | — |
| [CWE-1451](https://cwe.mitre.org/data/definitions/1451.html) | OpenSSF Secure Coding Guide for Python (2026) - 01 Introduction | Stable | — | — |
| [CWE-1452](https://cwe.mitre.org/data/definitions/1452.html) | OpenSSF Secure Coding Guide for Python (2026) - 02 Encoding and Strings | Stable | — | — |
| [CWE-1453](https://cwe.mitre.org/data/definitions/1453.html) | OpenSSF Secure Coding Guide for Python (2026) - 03 Numbers | Stable | — | — |
| [CWE-1454](https://cwe.mitre.org/data/definitions/1454.html) | OpenSSF Secure Coding Guide for Python (2026) - 04 Neutralization | Stable | — | — |
| [CWE-1455](https://cwe.mitre.org/data/definitions/1455.html) | OpenSSF Secure Coding Guide for Python (2026) - 05 Exception Handling | Stable | — | — |
| [CWE-1456](https://cwe.mitre.org/data/definitions/1456.html) | OpenSSF Secure Coding Guide for Python (2026) - 06 Logging | Stable | — | — |
| [CWE-1457](https://cwe.mitre.org/data/definitions/1457.html) | OpenSSF Secure Coding Guide for Python (2026) - 07 Concurrency | Stable | — | — |
| [CWE-1458](https://cwe.mitre.org/data/definitions/1458.html) | OpenSSF Secure Coding Guide for Python (2026) - 08 Coding Standards | Stable | — | — |
| [CWE-1459](https://cwe.mitre.org/data/definitions/1459.html) | OpenSSF Secure Coding Guide for Python (2026) - 09 Cryptography | Stable | — | — |

## 视图（62）

| 官方 ID | 名称 | 状态 | 抽象层级 / 类型 | 修复阶段（公告提供时） |
| --- | --- | --- | --- | --- |
| [CWE-604](https://cwe.mitre.org/data/definitions/604.html) | Deprecated Entries | Draft | Implicit | — |
| [CWE-629](https://cwe.mitre.org/data/definitions/629.html) | Weaknesses in OWASP Top Ten (2007) | Obsolete | Graph | — |
| [CWE-630](https://cwe.mitre.org/data/definitions/630.html) | DEPRECATED: Weaknesses Examined by SAMATE | Deprecated | Explicit | — |
| [CWE-631](https://cwe.mitre.org/data/definitions/631.html) | DEPRECATED: Resource-specific Weaknesses | Deprecated | Graph | — |
| [CWE-635](https://cwe.mitre.org/data/definitions/635.html) | Weaknesses Originally Used by NVD from 2008 to 2016 | Obsolete | Explicit | — |
| [CWE-658](https://cwe.mitre.org/data/definitions/658.html) | Weaknesses in Software Written in C | Draft | Implicit | — |
| [CWE-659](https://cwe.mitre.org/data/definitions/659.html) | Weaknesses in Software Written in C++ | Draft | Implicit | — |
| [CWE-660](https://cwe.mitre.org/data/definitions/660.html) | Weaknesses in Software Written in Java | Draft | Implicit | — |
| [CWE-661](https://cwe.mitre.org/data/definitions/661.html) | Weaknesses in Software Written in PHP | Draft | Implicit | — |
| [CWE-677](https://cwe.mitre.org/data/definitions/677.html) | Weakness Base Elements | Draft | Implicit | — |
| [CWE-678](https://cwe.mitre.org/data/definitions/678.html) | Composites | Draft | Implicit | — |
| [CWE-679](https://cwe.mitre.org/data/definitions/679.html) | DEPRECATED: Chain Elements | Deprecated | Implicit | — |
| [CWE-699](https://cwe.mitre.org/data/definitions/699.html) | Software Development | Draft | Graph | — |
| [CWE-700](https://cwe.mitre.org/data/definitions/700.html) | Seven Pernicious Kingdoms | Incomplete | Graph | — |
| [CWE-701](https://cwe.mitre.org/data/definitions/701.html) | Weaknesses Introduced During Design | Incomplete | Implicit | — |
| [CWE-702](https://cwe.mitre.org/data/definitions/702.html) | Weaknesses Introduced During Implementation | Incomplete | Implicit | — |
| [CWE-709](https://cwe.mitre.org/data/definitions/709.html) | Named Chains | Incomplete | Implicit | — |
| [CWE-711](https://cwe.mitre.org/data/definitions/711.html) | Weaknesses in OWASP Top Ten (2004) | Obsolete | Graph | — |
| [CWE-734](https://cwe.mitre.org/data/definitions/734.html) | Weaknesses Addressed by the CERT C Secure Coding Standard (2008) | Obsolete | Graph | — |
| [CWE-750](https://cwe.mitre.org/data/definitions/750.html) | Weaknesses in the 2009 CWE/SANS Top 25 Most Dangerous Programming Errors | Obsolete | Graph | — |
| [CWE-800](https://cwe.mitre.org/data/definitions/800.html) | Weaknesses in the 2010 CWE/SANS Top 25 Most Dangerous Programming Errors | Obsolete | Graph | — |
| [CWE-809](https://cwe.mitre.org/data/definitions/809.html) | Weaknesses in OWASP Top Ten (2010) | Obsolete | Graph | — |
| [CWE-844](https://cwe.mitre.org/data/definitions/844.html) | Weaknesses Addressed by The CERT Oracle Secure Coding Standard for Java (2011) | Obsolete | Graph | — |
| [CWE-868](https://cwe.mitre.org/data/definitions/868.html) | Weaknesses Addressed by the SEI CERT C++ Coding Standard (2016 Version) | Obsolete | Graph | — |
| [CWE-884](https://cwe.mitre.org/data/definitions/884.html) | CWE Cross-section | Incomplete | Explicit | — |
| [CWE-888](https://cwe.mitre.org/data/definitions/888.html) | Software Fault Pattern (SFP) Clusters | Incomplete | Graph | — |
| [CWE-900](https://cwe.mitre.org/data/definitions/900.html) | Weaknesses in the 2011 CWE/SANS Top 25 Most Dangerous Software Errors | Obsolete | Graph | — |
| [CWE-919](https://cwe.mitre.org/data/definitions/919.html) | Weaknesses in Mobile Applications | Incomplete | Implicit | — |
| [CWE-928](https://cwe.mitre.org/data/definitions/928.html) | Weaknesses in OWASP Top Ten (2013) | Obsolete | Graph | — |
| [CWE-999](https://cwe.mitre.org/data/definitions/999.html) | DEPRECATED: Weaknesses without Software Fault Patterns | Deprecated | Implicit | — |
| [CWE-1000](https://cwe.mitre.org/data/definitions/1000.html) | Complete Weakness Hierarchy | Draft | Graph | — |
| [CWE-1003](https://cwe.mitre.org/data/definitions/1003.html) | Weaknesses for Simplified Mapping of Published Vulnerabilities | Incomplete | Graph | — |
| [CWE-1008](https://cwe.mitre.org/data/definitions/1008.html) | Architectural Concepts | Obsolete | Graph | — |
| [CWE-1026](https://cwe.mitre.org/data/definitions/1026.html) | Weaknesses in OWASP Top Ten (2017) | Incomplete | Graph | — |
| [CWE-1040](https://cwe.mitre.org/data/definitions/1040.html) | Quality Weaknesses with Indirect Security Impacts | Incomplete | Implicit | — |
| [CWE-1081](https://cwe.mitre.org/data/definitions/1081.html) | Entries with Maintenance Notes | Draft | Implicit | — |
| [CWE-1128](https://cwe.mitre.org/data/definitions/1128.html) | CISQ Quality Measures (2016) | Incomplete | Graph | — |
| [CWE-1133](https://cwe.mitre.org/data/definitions/1133.html) | Weaknesses Addressed by the SEI CERT Oracle Coding Standard for Java | Stable | Graph | — |
| [CWE-1154](https://cwe.mitre.org/data/definitions/1154.html) | Weaknesses Addressed by the SEI CERT C Coding Standard | Stable | Graph | — |
| [CWE-1178](https://cwe.mitre.org/data/definitions/1178.html) | Weaknesses Addressed by the SEI CERT Perl Coding Standard | Stable | Graph | — |
| [CWE-1194](https://cwe.mitre.org/data/definitions/1194.html) | Hardware Design | Draft | Graph | — |
| [CWE-1200](https://cwe.mitre.org/data/definitions/1200.html) | Weaknesses in the 2019 CWE Top 25 Most Dangerous Software Errors | Stable | Graph | — |
| [CWE-1305](https://cwe.mitre.org/data/definitions/1305.html) | CISQ Quality Measures (2020) | Incomplete | Graph | — |
| [CWE-1337](https://cwe.mitre.org/data/definitions/1337.html) | Weaknesses in the 2021 CWE Top 25 Most Dangerous Software Weaknesses | Stable | Graph | — |
| [CWE-1340](https://cwe.mitre.org/data/definitions/1340.html) | CISQ Data Protection Measures | Incomplete | Graph | — |
| [CWE-1343](https://cwe.mitre.org/data/definitions/1343.html) | Weaknesses in the 2021 CWE Most Important Hardware Weaknesses List | Stable | Explicit | — |
| [CWE-1344](https://cwe.mitre.org/data/definitions/1344.html) | Weaknesses in OWASP Top Ten (2021) | Incomplete | Graph | — |
| [CWE-1350](https://cwe.mitre.org/data/definitions/1350.html) | Weaknesses in the 2020 CWE Top 25 Most Dangerous Software Weaknesses | Stable | Graph | — |
| [CWE-1358](https://cwe.mitre.org/data/definitions/1358.html) | Weaknesses in SEI ETF Categories of Security Vulnerabilities in ICS | Incomplete | Graph | — |
| [CWE-1387](https://cwe.mitre.org/data/definitions/1387.html) | Weaknesses in the 2022 CWE Top 25 Most Dangerous Software Weaknesses | Draft | Graph | — |
| [CWE-1400](https://cwe.mitre.org/data/definitions/1400.html) | Comprehensive Categorization for Software Assurance Trends | Draft | Graph | — |
| [CWE-1424](https://cwe.mitre.org/data/definitions/1424.html) | Weaknesses Addressed by ISA/IEC 62443 Requirements | Draft | Implicit | — |
| [CWE-1425](https://cwe.mitre.org/data/definitions/1425.html) | Weaknesses in the 2023 CWE Top 25 Most Dangerous Software Weaknesses | Draft | Graph | — |
| [CWE-1430](https://cwe.mitre.org/data/definitions/1430.html) | Weaknesses in the 2024 CWE Top 25 Most Dangerous Software Weaknesses | Draft | Graph | — |
| [CWE-1432](https://cwe.mitre.org/data/definitions/1432.html) | Weaknesses in the 2025 CWE Most Important Hardware Weaknesses List | Stable | Graph | — |
| [CWE-1435](https://cwe.mitre.org/data/definitions/1435.html) | Weaknesses in the 2025 CWE Top 25 Most Dangerous Software Weaknesses | Draft | Graph | — |
| [CWE-1448](https://cwe.mitre.org/data/definitions/1448.html) | Weaknesses Related to AI/ML Products | Incomplete | Graph | — |
| [CWE-1449](https://cwe.mitre.org/data/definitions/1449.html) | Weaknesses Addressed by the OpenSSF Secure Coding Guide for Python (2026) | Stable | Graph | — |
| [CWE-1450](https://cwe.mitre.org/data/definitions/1450.html) | Weaknesses in OWASP Top Ten RC1 (2025) | Incomplete | Graph | — |
| [CWE-1460](https://cwe.mitre.org/data/definitions/1460.html) | Weaknesses Addressed by the Top 20 Secure PLC Coding Practices | Stable | Explicit | — |
| [CWE-1468](https://cwe.mitre.org/data/definitions/1468.html) | Weaknesses Addressed by the OWASP Golang Secure Coding Practices Guide | Incomplete | Explicit | — |
| [CWE-2000](https://cwe.mitre.org/data/definitions/2000.html) | Comprehensive CWE Dictionary | Draft | Implicit | — |
