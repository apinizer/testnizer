PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE branches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      is_default INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
INSERT INTO "branches" ("id","project_id","name","parent_branch_id","created_at","is_default") VALUES ('729e17de-9801-4974-a028-59df3086f0ed','5b5ec514-8fc8-4893-8738-7c706b2ead7e','main',NULL,1793121667041,1);
CREATE TABLE certificates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'client',
      host TEXT,
      crt_path TEXT,
      key_path TEXT,
      pfx_path TEXT,
      passphrase TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'file',
      keystore_id TEXT,
      keystore_alias TEXT,
      keystore_key_password TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
CREATE TABLE endpoint_cases (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL,
      name TEXT NOT NULL,
      params TEXT,
      headers TEXT,
      body TEXT,
      auth TEXT,
      assertions TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
    );
CREATE TABLE endpoints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      folder_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      protocol TEXT NOT NULL DEFAULT 'http',
      method TEXT,
      path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'developing',
      request_schema TEXT,
      response_schemas TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, branch_id TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    );
INSERT INTO "endpoints" ("id","project_id","folder_id","name","description","protocol","method","path","status","request_schema","response_schemas","sort_order","created_at","updated_at","branch_id") VALUES ('c2633f0b-6a88-4c85-8506-c70da5340da4','5b5ec514-8fc8-4893-8738-7c706b2ead7e','d67931ee-f213-4cbc-9b38-493624a64d09','Get echo',NULL,'http','GET','/get','developing','{"url":"{{baseUrl}}/get?q={{query}}","method":"GET","params":[{"key":"q","value":"{{query}}","enabled":true}],"headers":[{"key":"X-Trace","value":"upgrade","enabled":true}],"auth":{"type":"inherit"},"body":{"type":"none"},"preScript":"pm.environment.set(''lastRun'', ''pre'')","postScript":"pm.test(''status 200'', () => pm.response.to.have.status(200))","assertions":[{"id":"a1","type":"status","operator":"eq","expected":"200","enabled":true}],"timeout":15000}',NULL,0,1793121666582,1793121666582,NULL);
INSERT INTO "endpoints" ("id","project_id","folder_id","name","description","protocol","method","path","status","request_schema","response_schemas","sort_order","created_at","updated_at","branch_id") VALUES ('18ed6d55-6cac-4d7c-91c2-0aed27e6e3ed','5b5ec514-8fc8-4893-8738-7c706b2ead7e','d9c94100-aa72-4c93-b3e2-73f2b40268e2','GraphQL users',NULL,'graphql','POST','/','developing','{"url":"http://127.0.0.1:63874/graphql","query":"{ users { id } }","variables":"{\"limit\":5}"}',NULL,1,1793121666582,1793121666582,NULL);
INSERT INTO "endpoints" ("id","project_id","folder_id","name","description","protocol","method","path","status","request_schema","response_schemas","sort_order","created_at","updated_at","branch_id") VALUES ('2245a9be-7ce0-446b-bbf0-6f3bf39347bd','5b5ec514-8fc8-4893-8738-7c706b2ead7e','d9c94100-aa72-4c93-b3e2-73f2b40268e2','SOAP balance',NULL,'soap','GET','/','developing','{"url":"http://127.0.0.1:63874/soap","wsdl":"http://127.0.0.1:63874/soap?wsdl","operation":"GetBalance","soapVersion":"1.1","envelope":"<soap:Envelope/>"}',NULL,2,1793121666582,1793121666582,NULL);
INSERT INTO "endpoints" ("id","project_id","folder_id","name","description","protocol","method","path","status","request_schema","response_schemas","sort_order","created_at","updated_at","branch_id") VALUES ('1136cb07-f4c8-480e-b0e1-76b162fe65b2','5b5ec514-8fc8-4893-8738-7c706b2ead7e','d9c94100-aa72-4c93-b3e2-73f2b40268e2','WS feed',NULL,'websocket','GET','/','developing','{"url":"ws://127.0.0.1:1/feed","savedMessages":[{"id":"m1","name":"hello","body":"{\"op\":\"hi\"}"}],"composerMode":"json"}',NULL,3,1793121666582,1793121666582,NULL);
INSERT INTO "endpoints" ("id","project_id","folder_id","name","description","protocol","method","path","status","request_schema","response_schemas","sort_order","created_at","updated_at","branch_id") VALUES ('b014d632-0f20-4e6e-8e8e-e03c5d257bb7','5b5ec514-8fc8-4893-8738-7c706b2ead7e','d9c94100-aa72-4c93-b3e2-73f2b40268e2','Socket.IO chat',NULL,'socketio','GET','/','developing','{"url":"http://127.0.0.1:1","namespace":"/chat","listeners":["message"],"emitEvent":"join","emitPayload":"{\"room\":\"a\"}"}',NULL,4,1793121666583,1793121666583,NULL);
INSERT INTO "endpoints" ("id","project_id","folder_id","name","description","protocol","method","path","status","request_schema","response_schemas","sort_order","created_at","updated_at","branch_id") VALUES ('501c267b-5b85-4a7e-90db-858a13b405bf','5b5ec514-8fc8-4893-8738-7c706b2ead7e','d9c94100-aa72-4c93-b3e2-73f2b40268e2','MQTT telemetry',NULL,'mqtt','GET','/','developing','{"url":"mqtt://127.0.0.1:1","topic":"tele/#","qos":1}',NULL,5,1793121666583,1793121666583,NULL);
INSERT INTO "endpoints" ("id","project_id","folder_id","name","description","protocol","method","path","status","request_schema","response_schemas","sort_order","created_at","updated_at","branch_id") VALUES ('3b698d6a-dc97-455b-b759-08bb49bf4f7c','5b5ec514-8fc8-4893-8738-7c706b2ead7e','d9c94100-aa72-4c93-b3e2-73f2b40268e2','MCP tools',NULL,'mcp','GET','/','developing','{"transport":"http","url":"http://127.0.0.1:1/mcp","toolName":"echo","toolArgs":"{\"text\":\"hi\"}"}',NULL,6,1793121666583,1793121666583,NULL);
INSERT INTO "endpoints" ("id","project_id","folder_id","name","description","protocol","method","path","status","request_schema","response_schemas","sort_order","created_at","updated_at","branch_id") VALUES ('5d4ae919-4c6f-4231-9227-1893547c2c55','5b5ec514-8fc8-4893-8738-7c706b2ead7e','d9c94100-aa72-4c93-b3e2-73f2b40268e2','gRPC health',NULL,'grpc','GET','/','developing','{"url":"127.0.0.1:1","service":"grpc.health.v1.Health","method":"Check"}',NULL,7,1793121666583,1793121666583,NULL);
INSERT INTO "endpoints" ("id","project_id","folder_id","name","description","protocol","method","path","status","request_schema","response_schemas","sort_order","created_at","updated_at","branch_id") VALUES ('fa4d537b-887f-4184-9a89-be245a851a47','5b5ec514-8fc8-4893-8738-7c706b2ead7e','d9c94100-aa72-4c93-b3e2-73f2b40268e2','SSE ticks',NULL,'sse','GET','/','developing','{"url":"http://127.0.0.1:63874/sse"}',NULL,8,1793121666583,1793121666583,NULL);
INSERT INTO "endpoints" ("id","project_id","folder_id","name","description","protocol","method","path","status","request_schema","response_schemas","sort_order","created_at","updated_at","branch_id") VALUES ('3ab3330b-4c75-4f31-b278-8c528d7ea636','e41f30cd-ec7e-4174-9935-d0f946066db7',NULL,'List items',NULL,'http','POST','/post','developing','{"url":"http://127.0.0.1:63874/post","method":"POST","body":{"type":"json","content":"{\"sku\":\"A-1\",\"qty\":2}"},"auth":{"type":"basic","basic":{"username":"fixture-user","password":"{{basicPass}}"}}}',NULL,0,1793121666584,1793121666584,NULL);
CREATE TABLE environment_variables (
      id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      secret INTEGER NOT NULL DEFAULT 0,
      initial_value TEXT,
      FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
    );
INSERT INTO "environment_variables" ("id","environment_id","key","value","description","enabled","secret","initial_value") VALUES ('0a2cd7f1-3d61-4c42-9cac-1d0a71e9d4c4','c9af31dd-0c34-4eac-839f-4f297ad1fcf5','baseUrl','http://127.0.0.1:63874',NULL,1,0,'http://127.0.0.1:63874');
INSERT INTO "environment_variables" ("id","environment_id","key","value","description","enabled","secret","initial_value") VALUES ('05b51496-987e-4cc1-b807-45fc04b3ea59','c9af31dd-0c34-4eac-839f-4f297ad1fcf5','query','current-q',NULL,1,0,'initial-q');
INSERT INTO "environment_variables" ("id","environment_id","key","value","description","enabled","secret","initial_value") VALUES ('4024eade-049a-4d89-9d2e-946cc71bd82b','c9af31dd-0c34-4eac-839f-4f297ad1fcf5','token','fixture-token-current-v1.5.4',NULL,1,1,'fixture-token-initial-v1.5.4');
INSERT INTO "environment_variables" ("id","environment_id","key","value","description","enabled","secret","initial_value") VALUES ('f4a64ca0-4f80-42af-a635-4601e5aa7430','c9af31dd-0c34-4eac-839f-4f297ad1fcf5','basicPass','',NULL,1,1,'fixture-pass-initial-v1.5.4');
INSERT INTO "environment_variables" ("id","environment_id","key","value","description","enabled","secret","initial_value") VALUES ('fae2d638-897f-4fb2-8fb6-f01b4b674f21','148fa60e-4bb7-48c0-975c-760e4b47399a','region','eu',NULL,0,0,NULL);
INSERT INTO "environment_variables" ("id","environment_id","key","value","description","enabled","secret","initial_value") VALUES ('8d4dbbd1-0e90-4f1c-aa0c-97828cd31a19','c9af31dd-0c34-4eac-839f-4f297ad1fcf5','lastRun','pre',NULL,1,0,NULL);
CREATE TABLE environments (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, project_id TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
INSERT INTO "environments" ("id","workspace_id","name","is_active","created_at","updated_at","project_id") VALUES ('c9af31dd-0c34-4eac-839f-4f297ad1fcf5','098169f4-61b3-4483-bfc5-26badeef904c','Staging',1,1793121666585,1793121666585,'5b5ec514-8fc8-4893-8738-7c706b2ead7e');
INSERT INTO "environments" ("id","workspace_id","name","is_active","created_at","updated_at","project_id") VALUES ('148fa60e-4bb7-48c0-975c-760e4b47399a','098169f4-61b3-4483-bfc5-26badeef904c','Production',0,1793121666586,1793121666586,'e41f30cd-ec7e-4174-9935-d0f946066db7');
CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auth TEXT,
      pre_script TEXT,
      post_script TEXT, branch_id TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    );
INSERT INTO "folders" ("id","project_id","parent_id","name","sort_order","auth","pre_script","post_script","branch_id") VALUES ('d9c94100-aa72-4c93-b3e2-73f2b40268e2','5b5ec514-8fc8-4893-8738-7c706b2ead7e',NULL,'Accounts',0,'{"type":"bearer","bearer":{"token":"{{token}}","prefix":"Bearer"}}','pm.variables.set(''fromFolder'', ''yes'')','pm.test(''folder ok'', () => pm.expect(true).to.be.true)',NULL);
INSERT INTO "folders" ("id","project_id","parent_id","name","sort_order","auth","pre_script","post_script","branch_id") VALUES ('d67931ee-f213-4cbc-9b38-493624a64d09','5b5ec514-8fc8-4893-8738-7c706b2ead7e','d9c94100-aa72-4c93-b3e2-73f2b40268e2','Transfers',1,NULL,NULL,NULL,NULL);
INSERT INTO "folders" ("id","project_id","parent_id","name","sort_order","auth","pre_script","post_script","branch_id") VALUES ('22b49156-0ebb-4ea8-8374-6835865d8996','e41f30cd-ec7e-4174-9935-d0f946066db7',NULL,'Inventory',0,NULL,NULL,NULL,NULL);
CREATE TABLE global_variables (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      secret INTEGER NOT NULL DEFAULT 0,
      initial_value TEXT, project_id TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
INSERT INTO "global_variables" ("id","workspace_id","key","value","description","enabled","secret","initial_value","project_id") VALUES ('cc103654-ef56-4d8c-b7d0-9f7e353b77f0','098169f4-61b3-4483-bfc5-26badeef904c','apiVersion','v2',NULL,1,0,'v1','5b5ec514-8fc8-4893-8738-7c706b2ead7e');
INSERT INTO "global_variables" ("id","workspace_id","key","value","description","enabled","secret","initial_value","project_id") VALUES ('4d2ebbf7-b67e-4fd8-9535-4f66aaae251a','098169f4-61b3-4483-bfc5-26badeef904c','clientSecret','fixture-client-secret-v1.5.4',NULL,1,1,'fixture-client-secret-initial-v1.5.4','5b5ec514-8fc8-4893-8738-7c706b2ead7e');
CREATE TABLE history (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      project_id TEXT,
      endpoint_id TEXT,
      protocol TEXT NOT NULL DEFAULT 'http',
      method TEXT,
      url TEXT NOT NULL,
      status_code INTEGER,
      duration_ms INTEGER,
      request_snapshot TEXT NOT NULL DEFAULT '{}',
      response_snapshot TEXT,
      executed_at INTEGER NOT NULL
    );
INSERT INTO "history" ("id","workspace_id","project_id","endpoint_id","protocol","method","url","status_code","duration_ms","request_snapshot","response_snapshot","executed_at") VALUES ('ce13ea35-5721-4188-b61a-3f99e7e72005','098169f4-61b3-4483-bfc5-26badeef904c','5b5ec514-8fc8-4893-8738-7c706b2ead7e','c2633f0b-6a88-4c85-8506-c70da5340da4','http','GET','http://127.0.0.1:63874/get?q=current-q',200,12,'{"method":"GET","url":"http://127.0.0.1:63874/get?q=current-q","headers":{}}','{"status":200,"body":"{\"args\":{\"q\":\"current-q\"}}"}',1793121666589);
INSERT INTO "history" ("id","workspace_id","project_id","endpoint_id","protocol","method","url","status_code","duration_ms","request_snapshot","response_snapshot","executed_at") VALUES ('18b13da6-b3d4-4ce9-b081-33b32a6a6297',NULL,'5b5ec514-8fc8-4893-8738-7c706b2ead7e','c2633f0b-6a88-4c85-8506-c70da5340da4','http','GET','http://127.0.0.1:63874/get?q=current-q',200,15,'{"method":"GET","url":"http://127.0.0.1:63874/get?q=current-q","headers":[{"key":"X-Trace","value":"upgrade","enabled":true}],"params":[{"key":"q","value":"current-q","enabled":true}],"body":{"type":"none","content":""},"auth":{"type":"bearer"}}','{"status":200,"statusText":"OK","timing":{"total":15,"tcp":2,"ttfb":10,"download":0},"body":"{\"args\":{\"q\":\"current-q\"},\"headers\":{\"accept\":\"application/json, text/plain, */*\",\"x-trace\":\"upgrade\",\"authorization\":\"Bearer fixture-token-current-v1.5.4\",\"user-agent\":\"Testnizer/33.4.11\",\"accept-encoding\":\"gzip, compress, deflate, br\",\"host\":\"127.0.0.1:63874\",\"connection\":\"close\",\"X-Trace\":\"upgrade\"},\"origin\":\"\",\"url\":\"http://127.0.0.1:63874/get?q=current-q\"}","headers":{"content-type":"application/json","content-length":"363","date":"Tue, 27 Oct 2026 17:21:06 GMT","connection":"close"},"bodySize":363}',1793121666609);
CREATE TABLE keystores (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      blob TEXT NOT NULL,
      store_password TEXT,
      alias_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
CREATE TABLE mock_endpoints (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      path TEXT NOT NULL,
      path_mode TEXT NOT NULL DEFAULT 'exact',
      description TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auth_override TEXT NOT NULL DEFAULT '',
      schema_validation TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (server_id) REFERENCES mock_servers(id) ON DELETE CASCADE
    );
INSERT INTO "mock_endpoints" ("id","server_id","method","path","path_mode","description","priority","enabled","sort_order","auth_override","schema_validation","created_at","updated_at") VALUES ('51f31753-826d-479f-a578-f5c95e1a1ee3','98c7b6e3-65f1-4869-9697-1eb81d06555b','GET','/accounts/:id','exact','',0,1,0,'{"type":"basic","username":"fixture-u","password":"fixture-override-v1.5.4"}','',1793121666587,1793121666587);
CREATE TABLE mock_responses (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      status_code INTEGER NOT NULL DEFAULT 200,
      headers TEXT NOT NULL DEFAULT '[]',
      body_type TEXT NOT NULL DEFAULT 'json',
      body TEXT NOT NULL DEFAULT '',
      delay_ms INTEGER NOT NULL DEFAULT 0,
      condition TEXT NOT NULL DEFAULT '{"type":"always"}',
      script TEXT NOT NULL DEFAULT '',
      response_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (endpoint_id) REFERENCES mock_endpoints(id) ON DELETE CASCADE
    );
INSERT INTO "mock_responses" ("id","endpoint_id","name","status_code","headers","body_type","body","delay_ms","condition","script","response_order","enabled") VALUES ('a2f6cbfb-d43b-4654-a679-d01b28afd7e8','51f31753-826d-479f-a578-f5c95e1a1ee3','ok',200,'[{"name":"Content-Type","value":"application/json"}]','json','{"id":"{{request.params.id}}"}',0,'{"type":"always"}','',0,1);
CREATE TABLE mock_servers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      host TEXT NOT NULL DEFAULT '127.0.0.1',
      port INTEGER NOT NULL,
      base_path TEXT NOT NULL DEFAULT '',
      auto_start INTEGER NOT NULL DEFAULT 0,
      cors_enabled INTEGER NOT NULL DEFAULT 0,
      cors_allow_origins TEXT NOT NULL DEFAULT '*',
      cors_allow_methods TEXT NOT NULL DEFAULT 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS,QUERY',
      cors_allow_headers TEXT NOT NULL DEFAULT '*',
      cors_allow_credentials INTEGER NOT NULL DEFAULT 0,
      cors_max_age INTEGER NOT NULL DEFAULT 600,
      auth_config TEXT NOT NULL DEFAULT '{"type":"none"}',
      failure_config TEXT NOT NULL DEFAULT '{"enabled":false,"probability":0,"mode":"status","status":500,"timeoutMs":30000}',
      rate_limit_config TEXT NOT NULL DEFAULT '{"enabled":false,"requestsPerWindow":100,"windowMs":60000,"scope":"ip"}',
      echo_enabled INTEGER NOT NULL DEFAULT 0,
      proxy_enabled INTEGER NOT NULL DEFAULT 0,
      proxy_target TEXT NOT NULL DEFAULT '',
      proxy_record INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
INSERT INTO "mock_servers" ("id","project_id","name","description","host","port","base_path","auto_start","cors_enabled","cors_allow_origins","cors_allow_methods","cors_allow_headers","cors_allow_credentials","cors_max_age","auth_config","failure_config","rate_limit_config","echo_enabled","proxy_enabled","proxy_target","proxy_record","created_at","updated_at") VALUES ('98c7b6e3-65f1-4869-9697-1eb81d06555b','5b5ec514-8fc8-4893-8738-7c706b2ead7e','Accounts mock','','127.0.0.1',47811,'',0,1,'*','GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS,QUERY','*',0,600,'{"type":"bearer","token":"fixture-mock-token-v1.5.4"}','{"enabled":false,"probability":0,"mode":"status","status":500,"timeoutMs":30000}','{"enabled":false,"requestsPerWindow":100,"windowMs":60000,"scope":"ip"}',0,0,'',0,1793121666586,1793121666587);
CREATE TABLE otp_entries (
      id TEXT PRIMARY KEY,
      label TEXT,
      issuer TEXT,
      account TEXT,
      secret TEXT NOT NULL,
      algorithm TEXT NOT NULL DEFAULT 'SHA1',
      digits INTEGER NOT NULL DEFAULT 6,
      period INTEGER NOT NULL DEFAULT 30,
      type TEXT NOT NULL DEFAULT 'totp',
      counter INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'http',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, save_mode TEXT NOT NULL DEFAULT 'local', local_path TEXT, icon_emoji TEXT, icon_color TEXT DEFAULT '#2D5FA0', display_name TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
INSERT INTO "projects" ("id","workspace_id","name","description","type","sort_order","created_at","updated_at","save_mode","local_path","icon_emoji","icon_color","display_name") VALUES ('39de5f26-8bb4-428e-8650-ae1e01fc0487','098169f4-61b3-4483-bfc5-26badeef904c','My Project','Default project','http',0,1793121665820,1793121665820,'local',NULL,NULL,'#2D5FA0',NULL);
INSERT INTO "projects" ("id","workspace_id","name","description","type","sort_order","created_at","updated_at","save_mode","local_path","icon_emoji","icon_color","display_name") VALUES ('5b5ec514-8fc8-4893-8738-7c706b2ead7e','098169f4-61b3-4483-bfc5-26badeef904c','upgrade-a-v1.5.4',NULL,'http',1,1793121666580,1793121666580,'local',NULL,NULL,'#2D5FA0',NULL);
INSERT INTO "projects" ("id","workspace_id","name","description","type","sort_order","created_at","updated_at","save_mode","local_path","icon_emoji","icon_color","display_name") VALUES ('e41f30cd-ec7e-4174-9935-d0f946066db7','098169f4-61b3-4483-bfc5-26badeef904c','upgrade-b-v1.5.4',NULL,'http',2,1793121666581,1793121666581,'local',NULL,NULL,'#2D5FA0',NULL);
CREATE TABLE runner_history (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      environment_name TEXT,
      source TEXT NOT NULL DEFAULT 'Runner',
      iterations INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      total_endpoints INTEGER NOT NULL DEFAULT 0,
      passed_endpoints INTEGER NOT NULL DEFAULT 0,
      failed_endpoints INTEGER NOT NULL DEFAULT 0,
      total_tests INTEGER NOT NULL DEFAULT 0,
      passed_tests INTEGER NOT NULL DEFAULT 0,
      failed_tests INTEGER NOT NULL DEFAULT 0,
      skipped_tests INTEGER NOT NULL DEFAULT 0,
      avg_resp_time INTEGER NOT NULL DEFAULT 0,
      results_json TEXT,
      started_at INTEGER NOT NULL, folder_name TEXT, source_label TEXT, scheduled_task_id TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
INSERT INTO "runner_history" ("id","project_id","environment_name","source","iterations","duration_ms","total_endpoints","passed_endpoints","failed_endpoints","total_tests","passed_tests","failed_tests","skipped_tests","avg_resp_time","results_json","started_at","folder_name","source_label","scheduled_task_id") VALUES ('1681b2bd-bce3-4cd3-a8c4-98d7fbb5ed73','5b5ec514-8fc8-4893-8738-7c706b2ead7e','c9af31dd-0c34-4eac-839f-4f297ad1fcf5','Runner',1,21,1,0,1,3,2,1,0,15,'[{"endpointId":"c2633f0b-6a88-4c85-8506-c70da5340da4","endpointName":"Get echo","method":"GET","url":"http://127.0.0.1:63874/get?q=current-q","status":200,"statusText":"OK","duration":15,"passed":2,"failed":1,"skipped":0,"assertions":[{"passed":false,"error":"Unknown type: status"},{"name":"folder ok","passed":true},{"name":"status 200","passed":true}],"responseSize":363,"responseBody":"{\"args\":{\"q\":\"current-q\"},\"headers\":{\"accept\":\"application/json, text/plain, */*\",\"x-trace\":\"upgrade\",\"authorization\":\"Bearer fixture-token-current-v1.5.4\",\"user-agent\":\"Testnizer/33.4.11\",\"accept-encoding\":\"gzip, compress, deflate, br\",\"host\":\"127.0.0.1:63874\",\"connection\":\"close\",\"X-Trace\":\"upgrade\"},\"origin\":\"\",\"url\":\"http://127.0.0.1:63874/get?q=current-q\"}","responseHeaders":{"content-type":"application/json","content-length":"363","date":"Tue, 27 Oct 2026 17:21:06 GMT","connection":"close"},"requestHeaders":{"X-Trace":"upgrade","Authorization":"Bearer fixture-token-current-v1.5.4","User-Agent":"Testnizer/33.4.11"},"iteration":1,"phase":"main"}]',1793121666589,NULL,NULL,NULL);
CREATE TABLE save_history (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'local',
      path TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
CREATE TABLE saved_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      folder_id TEXT,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL DEFAULT 'http',
      method TEXT,
      url TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '[]',
      headers TEXT NOT NULL DEFAULT '[]',
      body TEXT,
      auth TEXT,
      pre_script TEXT,
      post_script TEXT,
      assertions TEXT NOT NULL DEFAULT '[]',
      metadata TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, branch_id TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    );
INSERT INTO "saved_requests" ("id","project_id","folder_id","name","protocol","method","url","params","headers","body","auth","pre_script","post_script","assertions","metadata","sort_order","created_at","updated_at","branch_id") VALUES ('d379984d-532e-446c-9044-5b5623bcde69','5b5ec514-8fc8-4893-8738-7c706b2ead7e','d9c94100-aa72-4c93-b3e2-73f2b40268e2','Saved POST','http','POST','http://127.0.0.1:63874/post','[]','[{"key":"Content-Type","value":"application/json","enabled":true}]','{"type":"json","content":"{\"a\":1}"}',NULL,NULL,NULL,'[]','{"pathVariables":[],"timeout":5000}',0,1793121666584,1793121666584,NULL);
CREATE TABLE saved_responses (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL DEFAULT 'http',
      method TEXT,
      url TEXT,
      status_code INTEGER,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    , request_json TEXT);
INSERT INTO "saved_responses" ("id","project_id","owner_type","owner_id","name","protocol","method","url","status_code","response_json","created_at","request_json") VALUES ('8dd58de1-ac3d-4c0a-92cc-b6bf43ea9ec3','5b5ec514-8fc8-4893-8738-7c706b2ead7e','endpoint','c2633f0b-6a88-4c85-8506-c70da5340da4','200 example','http','GET','http://127.0.0.1:63874/get',200,'{"status":200,"headers":{"content-type":"application/json"},"body":"{\"ok\":true}"}',1793121666584,'{"configured":{"url":"http://127.0.0.1:63874/get?q={{query}}"},"sent":{"url":"http://127.0.0.1:63874/get?q=x"}}');
INSERT INTO "saved_responses" ("id","project_id","owner_type","owner_id","name","protocol","method","url","status_code","response_json","created_at","request_json") VALUES ('50a665ec-af86-4875-acfe-f5d9aa65bde3','5b5ec514-8fc8-4893-8738-7c706b2ead7e','saved_request','d379984d-532e-446c-9044-5b5623bcde69','saved example','http',NULL,NULL,201,'{"status":201,"body":"{\"created\":true}"}',1793121666584,NULL);
CREATE TABLE scheduled_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      endpoint_ids TEXT NOT NULL DEFAULT '[]',
      folder_id TEXT,
      environment_id TEXT,
      interval_value INTEGER NOT NULL DEFAULT 60,
      interval_unit TEXT NOT NULL DEFAULT 'minutes',
      delay_ms INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL, schedule_type TEXT DEFAULT 'interval', schedule_time TEXT, schedule_days TEXT, schedule_cron TEXT, suite_id TEXT, setup_endpoint_ids TEXT, teardown_endpoint_ids TEXT, run_pre_script TEXT, run_post_script TEXT, stop_on_error INTEGER DEFAULT 1,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
CREATE TABLE test_suite_folders (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auth TEXT,
      pre_script TEXT,
      post_script TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (suite_id) REFERENCES test_suites(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES test_suite_folders(id) ON DELETE CASCADE
    );
CREATE TABLE test_suite_items (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL,
      folder_id TEXT,
      protocol TEXT NOT NULL,
      name TEXT NOT NULL,
      method TEXT,
      url TEXT,
      request_schema TEXT NOT NULL,
      assertions TEXT,
      source_endpoint_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (suite_id) REFERENCES test_suites(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES test_suite_folders(id) ON DELETE CASCADE
    );
INSERT INTO "test_suite_items" ("id","suite_id","folder_id","protocol","name","method","url","request_schema","assertions","source_endpoint_id","sort_order","created_at","updated_at") VALUES ('7ad02a7f-ab73-4d4d-97d6-ede0c18c78c4','ff26ae8d-efa8-452d-8e89-1d9deb057357',NULL,'http','Get echo','GET','{{baseUrl}}/get?q={{query}}','{"url":"{{baseUrl}}/get?q={{query}}","method":"GET","params":[{"key":"q","value":"{{query}}","enabled":true}],"headers":[{"key":"X-Trace","value":"upgrade","enabled":true}],"auth":{"type":"inherit"},"body":{"type":"none"},"preScript":"pm.environment.set(''lastRun'', ''pre'')","postScript":"pm.test(''status 200'', () => pm.response.to.have.status(200))","assertions":[{"id":"a1","type":"status","operator":"eq","expected":"200","enabled":true}],"timeout":15000}',NULL,'c2633f0b-6a88-4c85-8506-c70da5340da4',0,1793121666611,1793121666611);
CREATE TABLE test_suites (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      run_config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
INSERT INTO "test_suites" ("id","project_id","name","description","sort_order","run_config","created_at","updated_at") VALUES ('ff26ae8d-efa8-452d-8e89-1d9deb057357','5b5ec514-8fc8-4893-8738-7c706b2ead7e','Smoke suite',NULL,0,NULL,1793121666610,1793121666610);
CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      password_hash TEXT,
      salt TEXT,
      avatar_url TEXT,
      auth_provider TEXT NOT NULL DEFAULT 'local',
      provider_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    , recovery_email TEXT);
CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
INSERT INTO "workspaces" ("id","name","description","color","created_at","updated_at") VALUES ('098169f4-61b3-4483-bfc5-26badeef904c','Default Workspace','Your first workspace','#2D5FA0',1793121665820,1793121665820);
CREATE INDEX idx_branches_project ON branches(project_id);
CREATE INDEX idx_certificates_project ON certificates(project_id);
CREATE INDEX idx_endpoint_cases_endpoint ON endpoint_cases(endpoint_id);
CREATE INDEX idx_endpoints_branch ON endpoints(project_id, branch_id);
CREATE INDEX idx_endpoints_folder ON endpoints(folder_id);
CREATE INDEX idx_endpoints_project ON endpoints(project_id);
CREATE INDEX idx_env_vars_environment ON environment_variables(environment_id);
CREATE INDEX idx_environments_project ON environments(project_id);
CREATE INDEX idx_environments_workspace ON environments(workspace_id);
CREATE INDEX idx_folders_branch ON folders(project_id, branch_id);
CREATE INDEX idx_folders_project ON folders(project_id);
CREATE INDEX idx_global_vars_project ON global_variables(project_id);
CREATE INDEX idx_global_vars_workspace ON global_variables(workspace_id);
CREATE INDEX idx_history_executed_at ON history(executed_at);
CREATE INDEX idx_history_workspace ON history(workspace_id);
CREATE INDEX idx_mock_endpoints_server ON mock_endpoints(server_id);
CREATE INDEX idx_mock_responses_endpoint ON mock_responses(endpoint_id);
CREATE INDEX idx_mock_servers_project ON mock_servers(project_id);
CREATE INDEX idx_projects_workspace ON projects(workspace_id);
CREATE INDEX idx_runner_history_project ON runner_history(project_id);
CREATE INDEX idx_runner_history_scheduled_task ON runner_history(scheduled_task_id);
CREATE INDEX idx_runner_history_started ON runner_history(started_at);
CREATE INDEX idx_save_history_project ON save_history(project_id);
CREATE INDEX idx_saved_requests_branch ON saved_requests(project_id, branch_id);
CREATE INDEX idx_saved_requests_project ON saved_requests(project_id);
CREATE INDEX idx_saved_responses_owner ON saved_responses(owner_type, owner_id);
CREATE INDEX idx_saved_responses_project ON saved_responses(project_id);
CREATE INDEX idx_scheduled_tasks_project ON scheduled_tasks(project_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_test_suites_project ON test_suites(project_id);
CREATE INDEX idx_tsf_parent ON test_suite_folders(parent_id);
CREATE INDEX idx_tsf_suite ON test_suite_folders(suite_id);
CREATE INDEX idx_tsi_folder ON test_suite_items(folder_id);
CREATE INDEX idx_tsi_suite ON test_suite_items(suite_id);
CREATE INDEX idx_tsi_suite_sort ON test_suite_items(suite_id, sort_order);
CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_username ON users(username);
CREATE TRIGGER trg_saved_responses_endpoint_del
      AFTER DELETE ON endpoints BEGIN
        DELETE FROM saved_responses WHERE owner_type = 'endpoint' AND owner_id = OLD.id;
      END;
CREATE TRIGGER trg_saved_responses_project_del
      AFTER DELETE ON projects BEGIN
        DELETE FROM saved_responses WHERE project_id = OLD.id;
      END;
CREATE TRIGGER trg_saved_responses_saved_request_del
      AFTER DELETE ON saved_requests BEGIN
        DELETE FROM saved_responses WHERE owner_type = 'saved_request' AND owner_id = OLD.id;
      END;
CREATE TRIGGER trg_saved_responses_suite_del
      BEFORE DELETE ON test_suites BEGIN
        DELETE FROM saved_responses WHERE owner_type = 'test_suite_item'
          AND owner_id IN (SELECT id FROM test_suite_items WHERE suite_id = OLD.id);
      END;
CREATE TRIGGER trg_saved_responses_suite_folder_del
      BEFORE DELETE ON test_suite_folders BEGIN
        DELETE FROM saved_responses WHERE owner_type = 'test_suite_item'
          AND owner_id IN (SELECT id FROM test_suite_items WHERE folder_id = OLD.id);
      END;
CREATE TRIGGER trg_saved_responses_suite_item_del
      AFTER DELETE ON test_suite_items BEGIN
        DELETE FROM saved_responses WHERE owner_type = 'test_suite_item' AND owner_id = OLD.id;
      END;
CREATE TRIGGER trg_saved_responses_workspace_del
      BEFORE DELETE ON workspaces BEGIN
        DELETE FROM saved_responses
          WHERE project_id IN (SELECT id FROM projects WHERE workspace_id = OLD.id);
      END;
COMMIT;
