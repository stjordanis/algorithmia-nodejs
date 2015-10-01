/**
 * Algorithmia Lambda Function
 *
 * Calls any algorithm in the Algorithmia marketplace
 * Get an API key and free credits by creating an account at algorithmia.com
 */

var AWS = require('aws-sdk');
var apiKey, kmsEncryptedApiKey;

/*
 * Step 1: Set your API key below
 *  Basic method:
 *    Set apiKey to your Algorithmia API key:
 *
 *  Advanced method (more secure):
 *    Set kmsEncryptedApiKey to the encrypted value after using AWS-KMS to encrypt your key:
 *
 *    To create a kmsEncryptedApiKey:
 *    - Create a KMS key - http://docs.aws.amazon.com/kms/latest/developerguide/create-keys.html
 *    - Encrypt your Algorithmia API key using the AWS CLI
 *      aws kms encrypt --key-id alias/<KMS key name> --plaintext "<ALGORITHMIA_API_KEY>"
 *    - Copy the base-64 encoded, encrypted key (CiphertextBlob) to the kmsEncryptedApiKey variable
 *    - Give your function's role permission for the kms:Decrypt action.
 *      Example:
 *          {
 *              "Version": "2012-10-17",
 *              "Statement": [
 *                  {
 *                      "Sid": "Stmt1443036478000",
 *                      "Effect": "Allow",
 *                      "Action": [
 *                          "kms:Decrypt"
 *                      ],
 *                      "Resource": [
 *                          "<your KMS Key ARN>"
 *                      ]
 *                  }
 *              ]
 *          }
 */
// apiKey = "<your Algorithmia api key>";       // Basic Method
// kmsEncryptedApiKey = "<encrypted kms key>";  // Advanced Method


var processEvent = function(event, context) {
    /*
     * Step 2: Set the algorithm you want to call
     *  This may be any algorithm in the Algorithmia marketplace
    */
    var algorithm = "<ALGORITHM>"; // e.g. "algo://opencv/SmartThumbnail"

    /*
     * Step 3: Use your event source to set inputData according to the algorithm's input format
     *
     *  Example: Create 200x50 thumbnails for an S3 file event using algo://opencv/SmartThumbnail
     *           Algorithm expects input as [URL, WIDTH, HEIGHT]
     *           Output is a base64 encoding of the resulting PNG thumbnail
     *
     *      var s3 = new AWS.S3();
     *      var bucket = event.Records[0].s3.bucket.name;
     *      var key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " ")) ;
     *      var params = {Bucket: bucket, Key: key};
     *      var signedUrl = s3.getSignedUrl('getObject', params);
     *      var inputData = [signedUrl, 200, 50];
     */
    var inputData = "<INPUT_DATA>";

    // Run the algorithm
    var client = algorithmia(apiKey);
    client.algo(algorithm).pipe(inputData).then(function(output) {
        if(output.error) {
            console.log("Error: " + output.error.message);
            context.fail(output.error.message);
        } else {
            console.log(output.result);
            context.succeed(output.result);
        }
    });
}

/*
 * This is the lambda entrypoint (no modification necessary)
 *   it ensures apiKey is set (decrypting kmsEncryptedApiKey if provided)
 *   and then calls processEvent with the same event and context
 */
exports.handler = function(event, context) {
    if(kmsEncryptedApiKey) {
        var encryptedBuf = new Buffer(kmsEncryptedApiKey, 'base64');
        var cipherText = { CiphertextBlob: encryptedBuf };

        var kms = new AWS.KMS();
        kms.decrypt(cipherText, function(err, data) {
            if (err) {
                console.log("Decrypt error: " + err);
                context.fail(err);
            } else {
                apiKey = data.Plaintext.toString('ascii');
                processEvent(event, context);
            }
        });
    } else if(apiKey) {
        processEvent(event, context);
    } else {
        context.fail("API Key has not been set.")
    }
};


/*
 * Algorithmia NodeJS SDK below
 */
var Algorithm, AlgorithmiaClient, Data, algorithmia, https, url;
https = require('https');
url = require('url');

AlgorithmiaClient = (function() {
  function AlgorithmiaClient(key) {
    this.api_path = 'https://api.algorithmia.com/v1/';
    if (key.indexOf('Simple ') === 0) {
      this.api_key = key;
    } else {
      this.api_key = 'Simple ' + key;
    }
  }

  AlgorithmiaClient.prototype.algo = function(path) {
    return new Algorithm(this, path);
  };

  AlgorithmiaClient.prototype.file = function(path) {
    return new Data(this, path);
  };

  AlgorithmiaClient.prototype.req = function(path, method, data, cheaders, callback) {
    var dheader, key, options, req, val;
    dheader = {
      'Content-Type': 'application/JSON',
      'Accept': 'application/JSON',
      'Authorization': this.api_key,
      'User-Agent': 'NodeJS/' + process.version
    };
    for (key in cheaders) {
      val = cheaders[key];
      dheader[key] = val;
    }
    options = url.parse(this.api_path + path);
    options.method = method;
    options.headers = dheader;
    req = https.request(options, function(res) {
      var chunks;
      res.setEncoding('utf8');
      chunks = [];
      res.on('data', function(chunk) {
        return chunks.push(chunk);
      });
      res.on('end', function() {
        var body, buff;
        buff = chunks.join('');
        if (dheader['Accept'] === 'application/JSON') {
          body = JSON.parse(buff);
        } else {
          body = buff;
        }
        if (callback) {
          if (res.statusCode !== 200) {
            if (!body) {
              body = {};
            }
            if (!body.error) {
              body.error = {
                message: 'HTTP Response: ' + res.statusCode
              };
            }
          }
          callback(body);
        }
      });
      return res;
    });
    req.write(data);
    return req.end();
  };

  return AlgorithmiaClient;

})();

algorithmia = function(key) {
  return new AlgorithmiaClient(key);
};


Algorithm = (function() {
  function Algorithm(client, path) {
    this.client = client;
    this.algo_path = path;
  }

  Algorithm.prototype.pipe = function(params) {
    this.algo_params = params;
    if (typeof params === 'object' || typeof params === 'string') {
      this.algo_data = JSON.stringify(params);
    } else {
      this.algo_data = params + '';
    }
    return this;
  };

  Algorithm.prototype.then = function(callback) {
    return this.client.req('algo/' + this.algo_path, 'POST', this.algo_data, {}, callback);
  };

  return Algorithm;

})();


Data = (function() {
  function Data(client, path) {
    this.client = client;
    if (path.indexOf("data://") !== 0) {
      throw "Supplied path is invalid.";
    }
    this.data_path = path.replace(/data\:\/\//, "");
  }

  Data.prototype.putString = function(content, callback) {
    var headers;
    headers = {
      'Content-Type': 'text/plain'
    };
    return this.client.req('data/' + this.data_path, 'PUT', content, headers, callback);
  };

  Data.prototype.putJson = function(content, callback) {
    var headers;
    headers = {
      'Content-Type': 'application/JSON'
    };
    return this.client.req('data/' + this.data_path, 'PUT', content, headers, callback);
  };

  Data.prototype.getString = function(callback) {
    var headers;
    headers = {
      'Accept': 'text/plain'
    };
    return this.client.req('data/' + this.data_path, 'GET', "", headers, callback);
  };

  Data.prototype.getJson = function(callback) {
    var headers;
    headers = {
      'Accept': 'text/plain'
    };
    return this.client.req('data/' + this.data_path, 'GET', "", headers, callback);
  };

  return Data;

})();