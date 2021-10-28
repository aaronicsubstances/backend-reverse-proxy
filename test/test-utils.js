const assert = require('assert').strict;

const utils = require("../utils");

describe('utils', function(){
    describe('#normalizeUuid', function() {
        it('should normalize valid uuids successfully', function() {
            const expected = 'ccebe604-9e4e-4185-9a93-eddd247001b0';

            let input = 'ccebe604-9e4e-4185-9a93-eddd247001b0';
            let actual = utils.normalizeUuid(input);
            assert.equal(actual, expected);

            input = 'CCEBE604-9E4E-4185-9A93-EDDD247001B0';
            actual = utils.normalizeUuid(input);
            assert.equal(actual, expected);

            input = 'CCEBE6049E4E41859a93eddd247001b0';
            actual = utils.normalizeUuid(input);
            assert.equal(actual, expected);
        });
    });

    describe('#parseMainUrl', function() {
        it('should parse valid main url correctly', function() {
            const data = [
                ["/main-CCEBE604-9E4E-4185-9A93-EDDD247001B0/", 
                    ["ccebe604-9e4e-4185-9a93-eddd247001b0", "/"]], 
                ["/main-ccebe604-9e4e-4185-9a93-eddd247001b0", 
                    ["ccebe604-9e4e-4185-9a93-eddd247001b0", ""]], 
                ["/main-ccebe604-9e4e-4185-9a93-eddd247001b0?p=0", 
                    ["ccebe604-9e4e-4185-9a93-eddd247001b0", "?p=0"]]
            ];
            for (const testData of data) {
                const [ url, expected ] = testData;
                const actual = utils.parseMainUrl(url);
                assert.deepEqual(actual, expected);
            }
        })
    })
})