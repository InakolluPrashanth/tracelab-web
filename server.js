const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 10000;

const ONECOMPILER_URL =
  process.env.ONECOMPILER_URL ||
  'https://api.onecompiler.org/v1/run';

const ONECOMPILER_API_KEY =
  process.env.ONECOMPILER_API_KEY || '';

/*
  Supports both the current Netlify site and the older site.
  You can also override this with the FRONTEND_ORIGINS
  environment variable in Render.
*/
const FRONTEND_ORIGINS = new Set(
  (process.env.FRONTEND_ORIGINS ||
    'https://tracelab-free.netlify.app,https://tracelabcompiler.netlify.app')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);


/* =========================================================
   BASIC SERVER CONFIG
========================================================= */

app.set('trust proxy', 1);


/* =========================================================
   SECURITY HEADERS
========================================================= */

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  res.setHeader(
    'X-Frame-Options',
    'SAMEORIGIN'
  );

  res.setHeader(
    'Referrer-Policy',
    'strict-origin-when-cross-origin'
  );

  next();
});


/* =========================================================
   CORS
========================================================= */

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && FRONTEND_ORIGINS.has(origin)) {
    res.setHeader(
      'Access-Control-Allow-Origin',
      origin
    );

    res.setHeader(
      'Vary',
      'Origin'
    );
  }

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});


/* =========================================================
   BODY PARSER
========================================================= */

app.use(
  express.json({
    limit: '32kb'
  })
);


/* =========================================================
   RATE LIMIT
========================================================= */

app.use(
  rateLimit({
    windowMs: 60 * 1000,

    max: 20,

    standardHeaders: true,

    legacyHeaders: false,

    message: {
      ok: false,
      error:
        'Too many execution requests. Please wait a minute and try again.'
    }
  })
);


/* =========================================================
   SUPPORTED LANGUAGES
========================================================= */

const SUPPORTED = {
  typescript: {
    id: 'typescript',
    ext: 'ts',
    name: 'TypeScript'
  },

  c: {
    id: 'c',
    ext: 'c',
    name: 'C'
  },

  cpp: {
    id: 'cpp',
    ext: 'cpp',
    name: 'C++'
  },

  java: {
    id: 'java',
    ext: 'java',
    name: 'Java'
  },

  go: {
    id: 'go',
    ext: 'go',
    name: 'Go'
  },

  kotlin: {
    id: 'kotlin',
    ext: 'kt',
    name: 'Kotlin'
  },

  swift: {
    id: 'swift',
    ext: 'swift',
    name: 'Swift'
  },

  ruby: {
    id: 'ruby',
    ext: 'rb',
    name: 'Ruby'
  },

  php: {
    id: 'php',
    ext: 'php',
    name: 'PHP'
  },

  perl: {
    id: 'perl',
    ext: 'pl',
    name: 'Perl'
  },

  bash: {
    id: 'bash',
    ext: 'sh',
    name: 'Bash'
  },

  sql: {
    id: 'sqlite',
    ext: 'sql',
    name: 'SQL / SQLite'
  }
};


/* =========================================================
   HEALTH
========================================================= */

function health() {
  return {
    ok: true,

    service:
      'TraceLab free execution backend',

    executorConfigured:
      Boolean(ONECOMPILER_API_KEY)
  };
}


/* =========================================================
   API CACHE CONTROL
========================================================= */

app.use('/api', (req, res, next) => {
  res.setHeader(
    'Cache-Control',
    'no-store'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});


/* =========================================================
   HEALTH ENDPOINT
========================================================= */

app.get('/api/health', (_req, res) => {
  res.json({
    ...health(),

    timestamp:
      new Date().toISOString()
  });
});


/* =========================================================
   RUNTIMES ENDPOINT
========================================================= */

app.get('/api/runtimes', (_req, res) => {
  res.json(
    Object.entries(SUPPORTED).map(
      ([id, item]) => ({
        id,
        name: item.name
      })
    )
  );
});


/* =========================================================
   PROVIDER DIAGNOSTIC
========================================================= */

app.post(
  '/api/diagnostics',
  async (_req, res) => {

    if (!ONECOMPILER_API_KEY) {
      return res.status(503).json({
        ok: false,
        backend: true,
        provider: false,

        error:
          'ONECOMPILER_API_KEY is not configured in the deployment environment.'
      });
    }

    const controller =
      new AbortController();

    const timer =
      setTimeout(() => {
        controller.abort();
      }, 12000);

    try {

      const response =
        await fetch(
          ONECOMPILER_URL,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              'X-API-Key':
                ONECOMPILER_API_KEY
            },

            body: JSON.stringify({
              language: 'cpp',

              stdin: '',

              files: [
                {
                  name:
                    'main.cpp',

                  content:
                    '#include <iostream>\n' +
                    'int main(){std::cout << 21;}'
                }
              ]
            }),

            signal:
              controller.signal
          }
        );


      const text =
        await response.text();


      let data;

      try {

        data =
          JSON.parse(text);

      } catch {

        data = {
          error: text
        };

      }


      if (!response.ok) {

        return res.status(502).json({
          ok: false,

          backend: true,

          provider: false,

          httpStatus:
            response.status,

          error:
            data.error ||
            data.message ||
            `Provider HTTP ${response.status}`
        });

      }


      const output =
        String(
          data.stdout || ''
        ).trim();


      const failed =
        data.status === 'failed' ||
        Boolean(
          data.error ||
          data.exception
        );


      return res.json({

        ok:
          !failed &&
          output === '21',

        backend: true,

        provider:
          !failed,

        cpp: {
          expected: '21',

          received:
            output,

          status:
            data.status || null,

          exception:
            data.exception || null,

          stderr:
            data.stderr || null
        }

      });

    } catch (error) {

      return res.status(503).json({

        ok: false,

        backend: true,

        provider: false,

        error:
          error?.name === 'AbortError'
            ? 'Provider diagnostic timed out.'
            : (
                error?.message ||
                'Provider connection failed.'
              )

      });

    } finally {

      clearTimeout(timer);

    }

  }
);


/* =========================================================
   FAST PROVIDER REQUEST
========================================================= */

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}


async function runOneCompiler(payload) {

  let lastError = null;


  /*
    Maximum two attempts.

    This is intentionally short.
    We do NOT make the user wait through
    a long percentage/progress system.
  */

  for (
    let attempt = 1;
    attempt <= 2;
    attempt++
  ) {

    const controller =
      new AbortController();


    /*
      45 seconds gives Render/OneCompiler
      enough time to wake and respond
      without immediately producing a
      browser "signal aborted" error.
    */

    const timer =
      setTimeout(() => {
        controller.abort();
      }, 45000);


    try {

      const response =
        await fetch(
          ONECOMPILER_URL,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              'Accept':
                'application/json',

              'X-API-Key':
                ONECOMPILER_API_KEY
            },

            body:
              JSON.stringify(payload),

            signal:
              controller.signal
          }
        );


      const text =
        await response.text();


      let data;

      try {

        data =
          JSON.parse(text);

      } catch {

        data = {
          error: text
        };

      }


      /*
        Successful HTTP response.
      */

      if (response.ok) {
        return {
          response,
          data
        };
      }


      lastError =
        new Error(
          data.error ||
          data.message ||
          `Provider HTTP ${response.status}`
        );


      /*
        Retry only temporary provider errors.
      */

      if (
        (
          response.status >= 500 ||
          response.status === 429
        ) &&
        attempt < 2
      ) {

        await sleep(250);

        continue;
      }


      throw lastError;


    } catch (error) {

      lastError =
        error;


      /*
        Retry temporary connection errors only.
      */

      if (
        attempt < 2 &&
        (
          error?.name ===
            'AbortError' ||

          error?.code ===
            'ECONNRESET' ||

          error?.code ===
            'ETIMEDOUT' ||

          error?.code ===
            'UND_ERR_CONNECT_TIMEOUT' ||

          error?.code ===
            'UND_ERR_SOCKET'
        )
      ) {

        await sleep(250);

        continue;
      }


      throw error;


    } finally {

      clearTimeout(timer);

    }

  }


  throw (
    lastError ||
    new Error(
      'Execution provider is unavailable.'
    )
  );

}


/* =========================================================
   EXECUTE CODE
========================================================= */

app.post(
  '/api/execute',
  async (req, res) => {

    const {
      language,
      code,
      stdin = ''
    } = req.body || {};


    /* -------------------------------------------------------
       VALIDATION
    ------------------------------------------------------- */

    if (
      !language ||
      typeof code !== 'string'
    ) {

      return res.status(400).json({

        ok: false,

        error:
          'language and code are required'

      });

    }


    if (
      code.length > 18000
    ) {

      return res.status(413).json({

        ok: false,

        error:
          'Code is limited to 18,000 characters.'

      });

    }


    if (
      typeof stdin !== 'string' ||
      stdin.length > 8000
    ) {

      return res.status(413).json({

        ok: false,

        error:
          'Input is limited to 8,000 characters.'

      });

    }


    if (
      !SUPPORTED[language]
    ) {

      return res.status(400).json({

        ok: false,

        error:
          `Unsupported language: ${language}`

      });

    }


    if (
      !ONECOMPILER_API_KEY
    ) {

      return res.status(503).json({

        ok: false,

        error:
          'The free execution provider is not configured yet. Add ONECOMPILER_API_KEY in Render environment variables.'

      });

    }


    /* -------------------------------------------------------
       RUNTIME
    ------------------------------------------------------- */

    const runtime =
      SUPPORTED[language];


    /* -------------------------------------------------------
       FILE NAME

       Java is special:
       class Main -> Main.java
    ------------------------------------------------------- */

    const fileName =
      language === 'java'
        ? 'Main.java'
        : `main.${runtime.ext}`;


    /* -------------------------------------------------------
       ONECOMPILER PAYLOAD
    ------------------------------------------------------- */

    const payload = {

      language:
        runtime.id,

      stdin,

      files: [
        {
          name:
            fileName,

          content:
            code
        }
      ]

    };


    /* -------------------------------------------------------
       SEND TO ONECOMPILER
    ------------------------------------------------------- */

    let response;
    let data;


    try {

      ({
        response,
        data
      } =
        await runOneCompiler(
          payload
        ));


    } catch (error) {

      const message =
        error?.name ===
          'AbortError'

          ? 'Execution timed out while waiting for the execution provider.'

          : (
              error?.message ||
              'Execution provider is temporarily unavailable.'
            );


      return res.status(503).json({

        ok: false,

        error: message,

        retryable: true

      });

    }


    /* -----------------------------------------------------
       BUILD OUTPUT
    ----------------------------------------------------- */

    const outputParts = [];


    if (
      data.stdout
    ) {

      outputParts.push(

        String(
          data.stdout
        ).trimEnd()

      );

    }


    if (
      data.stderr
    ) {

      outputParts.push(

        `stderr:\n${String(
          data.stderr
        ).trimEnd()}`

      );

    }


    if (
      data.exception
    ) {

      outputParts.push(

        `exception:\n${String(
          data.exception
        ).trimEnd()}`

      );

    }


    if (
      data.error
    ) {

      outputParts.push(

        `error:\n${String(
          data.error
        ).trimEnd()}`

      );

    }


    /* -----------------------------------------------------
       EXECUTION STATUS

       stderr alone does NOT automatically mean failure.
    ----------------------------------------------------- */

    const failed =
      data.status === 'failed' ||
      Boolean(data.exception) ||
      Boolean(data.error);


    const output =
      outputParts.length > 0

        ? outputParts.join(
            '\n'
          )

        : '(No output)';


    /* -----------------------------------------------------
       SEND RESULT BACK TO FRONTEND
    ----------------------------------------------------- */

    return res.json({

      ok:
        !failed,

      output,

      runtime:
        runtime.name,

      executionTime:
        data.executionTime ??
        null,

      memoryUsed:
        data.memoryUsed ??
        null

    });

  }

);


/* =========================================================
   STATIC FRONTEND
========================================================= */

app.use(
  express.static(
    path.join(
      __dirname,
      'public'
    )
  )
);


/* =========================================================
   SPA FALLBACK
========================================================= */

app.use(
  (req, res) => {

    if (
      req.path.startsWith(
        '/api/'
      )
    ) {

      return res.status(404).json({

        ok: false,

        error:
          'Not found'

      });

    }


    res.sendFile(

      path.join(
        __dirname,
        'public',
        'index.html'
      )

    );

  }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(

  PORT,

  '0.0.0.0',

  () => {

    console.log(
      `TraceLab free backend listening on ${PORT}`
    );

    console.log(
      `OneCompiler configured: ${
        Boolean(
          ONECOMPILER_API_KEY
        )
      }`
    );

  }

);
