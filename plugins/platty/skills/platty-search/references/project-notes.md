# 프로젝트 사실: ssgdx-mt-poc

실측일 2026-10-26. 분석을 다시 하면 달라질 수 있다. 준비 단계의 `context_status` 결과가 이 문서와 다르면 결과를 따른다.

## 저장소

기준정보(MT) 17개 저장소 PoC 프로젝트. 코드 검색 가이드의 ssgdx 20개 목록 중 `ssgdx-pda-web`, `ssgdx-ppm-web`, `ssgdx-ptp-settlement`는 이 프로젝트에 없다.

| 이름 | sourceRoot | 저장소 루트의 모듈·폴더 |
|---|---|---|
| ssgdx-mds-web | 없음 | Nexacro 화면 폴더 `CM CT IV MF MK MT ON OR PF PO PR SA SP SS ST`, `Library`, `common`, `frame`, `design`, `sample`, `nexacrolib` |
| ssgdx-ptp-web | 없음 | 화면 폴더 `CM CT IV MF MK MT ON OR PF PO PR SA SS ST`, `Library` (`frame`, `common`, `application.xadl`, `nginx.conf` 없음) |
| ssgdx-mdm-web | 없음 | 화면 폴더 `CM CT IV MT PF PO PR SS ST`, `FrameBase`, `frame`, `common`, `mdm.xadl`, `pda.xadl`, `ptp.xadl` |
| ssgdx-mds-foundation | ssgdx-mds-foundation-app | ssgdx-boot-autoconfigure, ssgdx-core, ssgdx-mds-common-api, ssgdx-mds-foundation-app, ssgdx-mds-master-api |
| ssgdx-mds-environment | ssgdx-mds-environment-app | ssgdx-mds-contract-api, ssgdx-mds-environment-app, ssgdx-mds-space-api, ssgdx-mds-store-api |
| ssgdx-mds-operation | ssgdx-mds-operation-app | ssgdx-mds-inventory-api, -manufacturing-api, -operation-app, -product-api, -purchase-api |
| ssgdx-mds-sales | ssgdx-mds-sales-app | ssgdx-mds-marketing-api, -online-api, -order-api, -sales-api, -sales-app |
| ssgdx-mds-settlement | ssgdx-mds-settlement-app | ssgdx-mds-settlement-api, -settlement-app |
| ssgdx-mds-performance | ssgdx-mds-performance-app | ssgdx-mds-performance-api, -performance-app |
| ssgdx-ptp-foundation | ssgdx-ptp-foundation-app | ssgdx-ptp-common-api, -foundation-app, -master-api (`ssgdx-core` 없음) |
| ssgdx-ptp-environment | ssgdx-ptp-environment-app | ssgdx-ptp-contract-api, -environment-app, -store-api (`space-api` 없음) |
| ssgdx-ptp-operation | ssgdx-ptp-operation-app | ssgdx-ptp-inventory-api, -manufacturing-api, -operation-app, -product-api, -purchase-api |
| ssgdx-ptp-sales | ssgdx-ptp-sales-app | ssgdx-ptp-marketing-api, -online-api, -order-api, -sales-api, -sales-app |
| ssgdx-ptp-performance | ssgdx-ptp-performance-app | ssgdx-ptp-performance-api, -performance-app |
| ssgdx-dms | ssgdx-dms-app | ssgdx-dms-api, ssgdx-dms-app |
| ssgdx-slc | ssgdx-slc-app | ssgdx-slc-api, ssgdx-slc-app |
| ssgdx-bat | 없음 | 단일 모듈 (`src/main/java`, `src/main/resources`). 배치 저장소 |

- 두 코드 도구는 sourceRoot(-app) 밖의 모듈까지 읽는다. 경로는 저장소 루트 기준(모듈 디렉터리부터)이다. 예: `ssgdx-mds-foundation/ssgdx-mds-master-api/src/main/resources/sql/`.
- 컨트롤러·서비스 구현은 `-app` 모듈, repository·SQL·DTO는 `-api` 모듈에 있다. 한 모듈만 읽고 끝내지 않는다.
- MDS(`ssgdx-mds-*`)와 PTP(`ssgdx-ptp-*`)는 모듈 구성과 컨트롤러 이름이 같을 수 있다. 같은 화면 이름이 `ssgdx-ptp-web`, `ssgdx-mdm-web`에도 있을 수 있다. 저장소 이름으로 구분해 적는다.

| 경로·패턴 (`ssgdx-mds-web` 기준) | 처리 |
|---|---|
| `nexacrolib/` (1,357개) | 프레임워크 라이브러리. 조사에서 제외(유일한 제외 경로) |
| `design/` (2,610개), `sample/` (130개) | 제외하지 않는다. 화면 서비스로 등록돼 있고(`typedefinition.xml:61-62`) 업무 화면·메뉴가 `design::`·`sample::`로 연다(예: `CM/CO/UI_CMCO_01801.xfdl:16`, `frame/frmLogin.xfdl` 68곳). 본 경로와 둘 다 있으면 둘 다 적는다 |
| `*_copy*`, `*backup*` 이름의 `.xfdl` (12개, 8개) | 팝업이 사본을 여는 경우가 있다(예: `CM/FM/UI_CMFM_00201.xfdl:1775`). 여는 호출 줄이 있으면 세고 없으면 "사본, 호출 없음" |
| `appvariables.xml` | 메뉴 초기 스냅샷. 운영 값의 근거로 쓰지 않는다 |
| 테스트 코드 `src/test` (백엔드) | 호출·사용처로 세지 않는다(목록 `제외` (다)) |

## 도구 상태

- `context_status`의 toolAvailability가 비어 있다(누락 도구 없음). `glossary_term_search`, `glossary_translate`는 이 세션에 없어 용어는 `term_lookup`, `data_dictionary_search`로 찾는다.
- `route_impact_candidates`(2026-10-27 개선판): `access`로 접근 종류를 거르고 `view: "compact"`로 후보 한 줄씩 받는다. 쓰기 우선 정렬, `accessClassCounts`(exact), `nextCursor`가 있다. `tables`는 한 번에 5개까지다. 다른 저장소의 서비스를 거쳐 쓰는 호출은 접근자로 잡지 못한다. `workspace_search`에는 여러 줄 옵션이 없고, 셸은 `repoId`가 필수이며, `spec_get`은 여전히 크다.
- `code_search_guide_get`: 저장소 역할, 화면→API→SQL 연결 규칙, 배치 구조. 20개 저장소 기준이라 없는 3개 설명이 섞여 있고, 로컬 경로(`/home/platty/ssgdx-repos`)는 쓰지 않는다.
- `job_dependency_trace`: J-Jobs 스냅샷(system `jjob`, instance `prod`). 인자는 `job: {"name": "<등록 이름>"}`이고 대소문자까지 그대로 쓴다(`btxxyy0001Job`은 되고 소문자·`Job` 없는 이름은 NOT_FOUND). 불확실하면 `job: {"key": "sched:jjob:prod:regular:<이름>"}`, `job: {"entryPointId": "<배치 route>"}`, `job: {"text": "<낱말>"}`(후보만 돌려줌)로 부른다. 응답의 `root.description`(스케줄 설명), `root.folder`, `root.status`(예 `active`)는 스케줄 스냅샷 정보다. 선행·후행은 `direction: "both"`, `depth: 1`로 불러 받은 nodes·edges에서 읽는다(비어 있지 않은 job이 있으니 조회 없이 "없음"으로 쓰지 않는다). triggers는 `[]`이거나 종류 코드(`D`, 뜻 확인 못함)인 job이 많고, 일부 job(예: 수시 배치 폴더)은 반복 간격 정보를 담는다. 있는 값만 "스케줄 스냅샷 기준"으로 쓴다. 실행 주기·마지막 실행은 이 결과에 없다. 선후행이 비었다는 결과는 "스케줄 정보에서 확인한 범위에서는"으로 쓰고 추론이다(등록 누락일 수 있음).
- 셸 허용 형태와 우회는 `explore.md` 7절. SQL XML 검색은 `rg -n -e 'mapper namespace'`처럼 `<`를 뺀다.

## 공통 버튼 (신규·저장·삭제)

- 화면 위쪽 신규·저장·삭제 버튼은 프레임(`ssgdx-mds-web/frame/frmWorkTitleDv.xfdl:24-26`)에 있다. 프레임이 `cfn` + 버튼 이름(`Add`·`Save`·`Del`)으로 함수 이름을 문자열로 조립해 화면의 같은 이름 함수를 부른다. 화면 코드에 호출부가 글자로 없고 `route_relations`도 이 경로의 API 호출을 놓친다. 화면에 `cfn` + 버튼 이름 + `Validation` 함수가 있으면 먼저 실행하고 확인 메시지를 거친다(목록 온라인 행의 "저장 전 검증 함수"). 이 누락은 공통 버튼 경유 호출에만 해당한다. 화면의 다른 호출, API·배치의 연결은 그대로 조회하고 공통 버튼 경로만 코드로 보완한다.
- 노출·권한 층 (사용 가능 여부 질문의 근거 노출·권한 행)

| 층 | 정해지는 곳 | 코드로 닫히나 |
|---|---|---|
| 메뉴 노출 | 로그인 SQL `ssgdx-mds-foundation/ssgdx-mds-common-api/src/main/resources/sql/mds/cm/sql-cm-CMLgn.xml`: 사용자 권한과 메뉴 연결, 메뉴 마스터 사용 여부 `Y`인 메뉴만 내려감 | 아니오(DB 값) |
| 버튼 노출 | 메뉴 데이터의 버튼 사용 값(신규 `newBtnUsgYn`, 저장 `savBtnUsgYn`, 삭제 `delBtnUsgYn`). 같은 로그인 SQL이 메뉴 마스터(`CM_MENU_M`) 값이 `N`이면 `N`, `Y`이면 유효한 권한들(`CM_BYAT_USR_MPNG`, 권한 종료일이 없거나 오늘 이후)의 권한별 메뉴 값(`CM_BYMAT_MENU_MPNG`) 최댓값. 둘 다 `Y`일 때만 보인다 | 아니오(DB 값 `DEL_BTN_USG_YN` 등) |
| 서버 권한 검사 | `ssgdx-mds-foundation/ssgdx-core/src/main/java/com/shinsegae/ssgdx/core/sso/interceptor/SessionCheckInterceptor.java`: 요청 버튼 플래그가 `Y`인데 세션의 권한별 메뉴 값이 `N`·없음이면 조회 `CM0809`·저장 `CM0811`·삭제 `CM0810`으로 거부, 메뉴 접근 권한 SQL(`selectByMenuAccessCheck`, `sql-cm-CmAthChk.xml`) 0건이면 `CM0108` | 예(플래그가 채워지는 곳과 접근 SQL 조건은 끝까지 읽지 않았다) |
| 기능 안의 조건 | 화면·서비스 코드(날짜 조건, 연결 데이터 존재 등) | 예(1층의 "막히는 경우") |

- 값을 저장하는 곳: 메뉴 마스터는 `sql-cm-CmMenuM.xml`(INSERT·UPDATE)과 서비스 `MenuMngService`·`CMPG002Service` 구현 클래스, 화면 `UI_CMPG_00201`(메뉴관리)로 보인다. 권한별 메뉴 값은 `sql-cm-CMAM004.xml`(INSERT·UPDATE), 화면 `UI_CMAM_00401`(메뉴권한 관리)로 보인다. 화면 연결은 이름이 맞는 것으로 본 추정이며 호출 줄은 읽지 않았다.
- 실제 Y/N 값은 운영 DB에 있다. 메뉴관리·메뉴권한 관리 화면이나 DB의 `CM_MENU_M`, `CM_BYMAT_MENU_MPNG`로 확인한다. `appvariables.xml`의 `gdsMenu` 초기값은 개발 때 스냅샷이고(예: `MT0501` "(개발중)MD 등록", 갱신 2023-05) 로그인 응답이 `gdsMenu=dsLoginMenu`로 대체하므로(`ssgdx-mds-web/frame/frmLogin.xfdl:3097`) "초기 스냅샷 값, 참고용"으로만 쓴다.

## URL 조립과 채널

- 화면(`ssgdx-mds-web`)의 서비스 기준 주소는 `<host>/<시스템코드>/on/`이다(`application.xadl:132`, 시스템코드 `mds`는 `environment.xml:13`). 화면 코드의 URL은 그 뒤의 상대 경로(`mt/pd/…`)이고 앞 슬래시가 섞여 있다. 모바일(`ssgdx-mdm-web`)은 `fvMoSvc` 같은 변수나 `/mo/…` 리터럴을 쓴다.
- 서버 경로는 `/<context-path>/<채널>/<도메인>/<서브>/<메서드>`다. 조각이 클래스·메서드 선언에 세 방식으로 나뉘어 전체 URL로는 소스에서 못 찾는다. 끝 3구간으로 찾는다(MT 화면 URL은 거의 모두 컨트롤러 끝 3구간과 일치). 도메인·서브는 대부분 컨트롤러 패키지 폴더와 같다(예외: 샘플·테스트, 파일 업로드, 외부 호출용 `/api/…`, 전자결재 `/cov/…`).
- 채널: `on`(대부분), `mo`, `eai`, `pos`, `pda`, `cov`, `api`, `gyr`. 뜻은 사용 방식으로 본 추정이다(`on`=PC 업무 화면, `mo`=모바일, `eai`=EAI 수신, `cov`=전자결재). `on`은 도메인코드로도 쓰인다(`/on/on/…`). 한 컨트롤러가 `on`과 `mo`를 함께 선언하면 route가 채널별로 둘이다.
- nginx(`ssgdx-mds-web/env/dev/nginx.conf`)는 `/mds/<채널>/<도메인>/`로 저장소를 정한다(채널 on, mo, eai, cov, api, gyr. rewrite는 주석). `pos`·`pda`는 이 규칙에 없다. 루트 `nginx.conf`는 개발자 PC용이라 기준으로 쓰지 않는다.
- 도메인코드→저장소: `cm·mt·dv`→ssgdx-mds-foundation, `ct·st·sp`→ssgdx-mds-environment, `pr·po·iv·mf`→ssgdx-mds-operation, `pf`→ssgdx-mds-performance, `sa·or·mk·on`→ssgdx-mds-sales, `ss`→ssgdx-mds-settlement. 파트너용(`ssgdx-ptp-*`)은 컨텍스트 `/ptp`이고 끝경로가 같을 수 있어 호출 화면 저장소(`ssgdx-mds-web`↔mds, `ssgdx-ptp-web`↔ptp)로 짝을 맞춘다.
- `ssgdx-mds-environment`의 API는 경로에 `/mds`가 빠진 채 등록돼 끝부분으로만 조회된다. 화면에만 있고 컨트롤러가 없는 URL도 있다(예: `mt/pd/retrieveStrShopPopList`, `UI_MTPD_01602`). 못 찾으면 "확인한 범위에서는 없음".

## 배치

- 배치 저장소는 `ssgdx-bat`이다(목록에서 이 저장소의 파일은 종류 `배치`). 구조는 `src/main/java/com/shinsegae/ssgdx/bat/<도메인2자>/<서브2자>/<job소문자명>/{job,step,tasklet}/`, SQL은 `src/main/resources/sql/<도메인>/<서브>/`. 예: `src/main/java/com/shinsegae/ssgdx/bat/mt/og/btxxyy0001/job/Btxxyy0001JobConfig.java:56-62`, `src/main/resources/sql/mt/og/sql-mt-btxxyy0001.xml`. 기준정보 배치는 `bat/mt/**`.
- job 이름 표기가 둘이다. 스케줄 등록과 Bean 이름은 `btxxyy0001Job`, 설정 메서드 이름은 `btxxyy0001job`(소문자). 목록 진입점에는 Bean 이름을 쓴다.
- `@Scheduled`는 java 검색 0건이다(걸린 것은 `src/main/java/com/shinsegae/ssgdx/SsgdxBatApplication.java:59`의 안내 문자열 한 줄). 실행 시점은 J-Jobs 스케줄 정보에 있다. 배치는 컨트롤러 없이 `-api` 모듈의 repository·서비스를 직접 부른다. 외부 시스템이 배치를 기동하는 코드는 저장소에 없다.

## 이벤트·외부 송신

2026-10-26 전체 저장소 java를 클래스 이름으로 검색한 결과다. 각 클래스의 역할·호출 조건은 읽지 않았다. 목록 외부 행의 진입점(송신 클래스)을 찾을 때 쓴다.

- EAI 송신: `EaiClientService`(`ssgdx-mds-foundation/ssgdx-core/src/main/java/com/shinsegae/ssgdx/core/eai/v2/EaiClientService.java`). `EaiClient`는 `ssgdx-bat`(기준정보 배치 tasklet `bat/mt/**/tasklet/` 포함)과 여러 온라인 모듈에 많다. 역할은 호출 줄의 인터페이스 ID로 구분한다. 다른 저장소의 서비스를 거쳐 나가기도 한다. 예: 한 화면의 저장 API가 부르는 서비스(`sendShopInfoToCms`)가 `stCmsBizAPIService`(`ssgdx-mds-environment`의 `ssgdx-mds-store-api`, `StCmsBizAPIService` 구현 클래스)를 부르고, 그 클래스가 `EaiClientService`를 쓴다.
- 큐 발행(SNS/SQS): 서비스가 부르는 쪽은 `QueueClientHelper`(`ssgdx-core`의 `core/queue`). `SnsClientHandler`는 `ssgdx-core`와 `AwsConfiguration` 안에서만 쓰인다. `QueueClientHelper` 사용 파일은 `ssgdx-mds-sales-app`, `ssgdx-mds-online-api`, `ssgdx-bat`, `ssgdx-mds-inventory-api` 등, foundation 쪽은 `ssgdx-mds-common-api`의 `NotfiMngService` 구현 클래스 등.
- 큐 수신: `@SqsListener`가 `ssgdx-mds-sales-app`, `ssgdx-mds-operation-app`, `ssgdx-mds-performance-app`, `ssgdx-mds-settlement-app`, `ssgdx-mds-foundation-app`(샘플)에 있다. 외부 수신 후보를 찾을 때 검색한다. 클라이언트 설정은 `AwsConfiguration.java:183`(`amazonSQSAsync`).
- Feign: `@FeignClient`가 `ssgdx-core`, `ssgdx-mds-contract-api`, `ssgdx-mds-foundation-app`에 있다. `RestTemplate`·`WebClient`는 `ssgdx-mds-product-api` 1개 파일뿐. `KafkaTemplate`, `RabbitTemplate`, `JmsTemplate`, `StreamBridge`, `ApplicationEventPublisher`는 0건.
- 송신 여부는 쓰기 서비스 메서드의 호출 줄이나 주입받는 클라이언트 필드를 읽어 닫는다. 위 이름이 서비스 파일에 없으면 "이 서비스 파일에서는 송신 호출을 찾지 못함"까지만 쓰고 하위 서비스를 한 단계 더 따라간다. 수신 endpoint(`/eai/...`)의 호출자(외부 시스템)는 저장소에 없다.

## 분석 범위

- 기준정보(MT) 범위가 정적 분석 대상이다. MT 화면·API·배치에는 메뉴 경로가 붙는다(예: `UI_MTBR_00101`(메뉴 브랜드관리 > 매장브랜드등록및조회), 배치 `btxxyy0001Job`).
- MT 밖 화면·배치는 deprecated(reason `user_manual`)로 나오고 생성 문서·메뉴 경로가 없다(예: `CT/CY/UI_CTCY_00101.xfdl`, `btCmAl0018Job`, `addbatchJob`). 코드에 없다는 뜻이 아니므로 원본 코드를 직접 읽는다.
- 메뉴 세트는 `default`. 루트 9개(MT01 점포/매장관리, MT02 조직관리, MT03 브랜드관리, MT04 상품브랜드관리, MT05 협력회사관리, MT06 통합상품관리, MT07 POS긴급전송, MT08 데이터정비(비활성), MT09 분리보관)는 화면 연결이 없고 하위 메뉴가 화면과 `key_match`로 연결된다.
- 하위 메뉴 id는 루트와 접두가 맞지 않는다(예: 통합상품관리 `MT06`의 하위가 `MT05…`). id로 계층을 추정하지 않고 메뉴 조회 결과의 경로를 쓴다. 비활성·미사용: `MT08`, `(미사용)타사마진등록`(`MT0521`, 화면 연결 없음).
- 용어: 같은 뜻이 컬럼마다 따로 용어 카드로 있거나(예: 점포코드) 같은 약어가 여러 뜻일 수 있다. 업무 언어 질문은 후보를 모두 확인한다. 생성 문서 규모는 `context_status`로 확인하고, EPIC에는 연결 없는 화면용 `ETC`가 있다.
