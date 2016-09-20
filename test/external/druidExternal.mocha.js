/*
 * Copyright 2015-2016 Imply Data, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var { expect } = require("chai");
var Q = require('q');
var { sane } = require('../utils');

var plywood = require('../../build/plywood');
var { External, TimeRange, $, ply, r, AttributeInfo } = plywood;

var timeFilter = $('time').in(TimeRange.fromJS({
  start: new Date("2013-02-26T00:00:00Z"),
  end: new Date("2013-02-27T00:00:00Z")
}));

var context = {
  wiki: External.fromJS({
    engine: 'druid',
    source: 'wikipedia',
    timeAttribute: 'time',
    attributes: [
      { name: 'time', type: 'TIME' },
      { name: 'sometimeLater', type: 'TIME' },
      { name: 'language', type: 'STRING' },
      { name: 'page', type: 'STRING' },
      { name: 'tags', type: 'SET/STRING' },
      { name: 'commentLength', type: 'NUMBER' },
      { name: 'isRobot', type: 'BOOLEAN' },
      { name: 'count', type: 'NUMBER', unsplitable: true },
      { name: 'added', type: 'NUMBER', unsplitable: true },
      { name: 'deleted', type: 'NUMBER', unsplitable: true },
      { name: 'inserted', type: 'NUMBER', unsplitable: true },
      { name: 'delta_hist', special: 'histogram' }
    ],
    derivedAttributes: {
      pageInBrackets: "'[' ++ $page ++ ']'"
    },
    filter: timeFilter,
    allowSelectQueries: true,
    version: '0.9.2',
    customAggregations: {
      crazy: {
        accessType: 'getSomeCrazy',
        aggregation: {
          type: 'crazy',
          the: 'borg will rise again',
          activate: false
        }
      },
      stupid: {
        accessType: 'iAmWithStupid',
        aggregation: {
          type: 'stoopid',
          onePlusOne: 3,
          globalWarming: 'hoax'
        }
      }
    },
    customTransforms: {
      makeFrenchCanadian: {
        type: 'extraction',
        outputName: 'sometimeLater',
        extractionFn: {
          "type": "timeFormat",
          "format": "EEEE",
          "timeZone": "America/Montreal",
          "locale": "fr"
        }
      },
      makeExcited: {
        extractionFn: {
          type: "javascript",
          "function": "function(str) { return str + '!!!'; }"
        },
        injective: true
      }
    }
  })
};

var contextNoApprox = {
  wiki: External.fromJS({
    engine: 'druid',
    source: 'wikipedia',
    timeAttribute: 'time',
    exactResultsOnly: true,
    attributes: [
      { name: 'time', type: 'TIME' },
      { name: 'language', type: 'STRING' },
      { name: 'page', type: 'STRING' },
      { name: 'added', type: 'NUMBER', unsplitable: true },
      { name: 'deleted', type: 'NUMBER', unsplitable: true },
      { name: 'inserted', type: 'NUMBER', unsplitable: true }
    ],
    filter: timeFilter
  })
};


describe("DruidExternal", () => {

  describe("simplifies / digests", () => {
    it("a (timeBoundary) total", () => {
      var ex = ply()
        .apply('maximumTime', '$wiki.max($time)')
        .apply('minimumTime', '$wiki.min($time)');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('literal');
      var druidExternal = ex.value.getReadyExternals()[0].external;

      expect(druidExternal.getQueryAndPostProcess().query).to.deep.equal({
        "dataSource": "wikipedia",
        "queryType": "timeBoundary"
      });
    });

    it("should properly process a simple value query", () => {
      var ex = $('wiki').filter($("language").is('en')).sum('$added');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;

      expect(druidExternal.getQueryAndPostProcess().query).to.deep.equal({
        "aggregations": [
          {
            "fieldName": "added",
            "name": "__VALUE__",
            "type": "doubleSum"
          }
        ],
        "dataSource": "wikipedia",
        "filter": {
          "dimension": "language",
          "type": "selector",
          "value": "en"
        },
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "queryType": "timeseries"
      });
    });

    it("should properly process a complex value query", () => {
      var ex = $('wiki').filter($("language").is('en')).sum('$added').add($('wiki').sum('$deleted'));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;

      expect(druidExternal.getQueryAndPostProcess().query).to.deep.equal({
        "aggregations": [
          {
            "aggregator": {
              "fieldName": "added",
              "name": "!T_0",
              "type": "doubleSum"
            },
            "filter": {
              "dimension": "language",
              "type": "selector",
              "value": "en"
            },
            "name": "!T_0",
            "type": "filtered"
          },
          {
            "fieldName": "deleted",
            "name": "!T_1",
            "type": "doubleSum"
          }
        ],
        "dataSource": "wikipedia",
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "postAggregations": [
          {
            "fields": [
              {
                "fieldName": "!T_0",
                "type": "fieldAccess"
              },
              {
                "fieldName": "!T_1",
                "type": "fieldAccess"
              }
            ],
            "fn": "+",
            "name": "__VALUE__",
            "type": "arithmetic"
          }
        ],
        "queryType": "timeseries"
      });
    });

    it("should properly process a total", () => {
      var ex = ply()
        .apply("wiki", $('wiki', 1).apply('addedTwice', '$added * 2').filter($("language").is('en')))
        .apply('Count', '$wiki.count()')
        .apply('TotalAdded', '$wiki.sum($added)');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('literal');
      var druidExternal = ex.value.getReadyExternals()[0].external;

      expect(druidExternal.getQueryAndPostProcess().query).to.deep.equal({
        "aggregations": [
          {
            "name": "Count",
            "type": "count"
          },
          {
            "fieldName": "added",
            "name": "TotalAdded",
            "type": "doubleSum"
          }
        ],
        "dataSource": "wikipedia",
        "filter": {
          "dimension": "language",
          "type": "selector",
          "value": "en"
        },
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "queryType": "timeseries"
      });
    });

    it("inlines a total with no explicit dataset apply", () => {
      var ex = ply()
        .apply('TotalAdded', '$wiki.sum($added)')
        .apply('TotalAddedX2', '$TotalAdded * 2');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('literal');
      var druidExternal = ex.value.getReadyExternals()[0].external;

      var queryAndPostProcess = druidExternal.getQueryAndPostProcess();
      expect(queryAndPostProcess.query).to.deep.equal({
        "aggregations": [
          {
            "fieldName": "added",
            "name": "TotalAdded",
            "type": "doubleSum"
          }
        ],
        "dataSource": "wikipedia",
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "postAggregations": [
          {
            "fields": [
              {
                "fieldName": "TotalAdded",
                "type": "fieldAccess"
              },
              {
                "type": "constant",
                "value": 2
              }
            ],
            "fn": "*",
            "name": "TotalAddedX2",
            "type": "arithmetic"
          }
        ],
        "queryType": "timeseries"
      });
    });

    it("processes a simple split", () => {
      var ex = $('wiki').split("$page", 'Page')
        .apply('Count', '$wiki.count()')
        .apply('Added', '$wiki.sum($added)')
        .sort('$Count', 'descending')
        .limit(5);

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query).to.deep.equal({
        "aggregations": [
          {
            "name": "Count",
            "type": "count"
          },
          {
            "fieldName": "added",
            "name": "Added",
            "type": "doubleSum"
          }
        ],
        "dataSource": "wikipedia",
        "dimension": {
          "dimension": "page",
          "outputName": "Page",
          "type": "default"
        },
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "metric": "Count",
        "queryType": "topN",
        "threshold": 5
      });
    });

    it("processes a split (no approximate)", () => {
      var ex = $('wiki').split("$page", 'Page')
        .apply('Count', '$wiki.count()')
        .apply('Added', '$wiki.sum($added)')
        .sort('$Count', 'descending')
        .limit(5);

      ex = ex.referenceCheck(contextNoApprox).resolve(contextNoApprox).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query).to.deep.equal({
        "aggregations": [
          {
            "name": "Count",
            "type": "count"
          },
          {
            "fieldName": "added",
            "name": "Added",
            "type": "doubleSum"
          }
        ],
        "dataSource": "wikipedia",
        "dimensions": [
          {
            "dimension": "page",
            "outputName": "Page",
            "type": "default"
          }
        ],
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "limitSpec": {
          "columns": [
            {
              "dimension": "Count",
              "direction": "descending"
            }
          ],
          "limit": 5,
          "type": "default"
        },
        "queryType": "groupBy"
      });
    });

    it("processes a split with custom aggregations", () => {
      var ex = $('wiki').split("$page", 'Page')
        .apply('CrazyStupid', '$wiki.customAggregate(crazy) * $wiki.customAggregate(stupid)')
        .apply('CrazyStupidBackCompat', '$wiki.custom(crazy) * $wiki.custom(stupid)')
        .sort('$CrazyStupid', 'descending')
        .limit(5);

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query).to.deep.equal({
        "aggregations": [
          {
            "activate": false,
            "name": "!T_0",
            "the": "borg will rise again",
            "type": "crazy"
          },
          {
            "globalWarming": "hoax",
            "name": "!T_1",
            "onePlusOne": 3,
            "type": "stoopid"
          }
        ],
        "dataSource": "wikipedia",
        "dimension": {
          "dimension": "page",
          "outputName": "Page",
          "type": "default"
        },
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "metric": "CrazyStupid",
        "postAggregations": [
          {
            "fields": [
              {
                "fieldName": "!T_0",
                "type": "getSomeCrazy"
              },
              {
                "fieldName": "!T_1",
                "type": "iAmWithStupid"
              }
            ],
            "fn": "*",
            "name": "CrazyStupid",
            "type": "arithmetic"
          },
          {
            "fields": [
              {
                "fieldName": "!T_0",
                "type": "getSomeCrazy"
              },
              {
                "fieldName": "!T_1",
                "type": "iAmWithStupid"
              }
            ],
            "fn": "*",
            "name": "CrazyStupidBackCompat",
            "type": "arithmetic"
          }
        ],
        "queryType": "topN",
        "threshold": 5
      });
    });

    it("works with complex aggregate expressions", () => {
      var ex = ply()
        .apply('SumAbs', '$wiki.sum($added.absolute())')
        .apply('SumComplex', '$wiki.sum($added.power(2) * $deleted / $added.absolute())');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('literal');
      var druidExternal = ex.value.getReadyExternals()[0].external;

      expect(druidExternal.getQueryAndPostProcess().query.aggregations).to.deep.equal([
        {
          "fieldNames": [
            "added"
          ],
          "fnAggregate": "function($$,_added) { return $$+Math.abs((+_added)); }",
          "fnCombine": "function(a,b) { return a+b; }",
          "fnReset": "function() { return 0; }",
          "name": "SumAbs",
          "type": "javascript"
        },
        {
          "fieldNames": [
            "added",
            "deleted"
          ],
          "fnAggregate": "function($$,_added,_deleted) { return $$+((Math.pow((+_added),2)*(+_deleted))/Math.abs((+_added))); }",
          "fnCombine": "function(a,b) { return a+b; }",
          "fnReset": "function() { return 0; }",
          "name": "SumComplex",
          "type": "javascript"
        }
      ]);
    });

    it("works with filtered complex aggregate expressions", () => {
      var ex = $('wiki').split("$page", 'Page')
        .apply('FilteredSumDeleted', '$wiki.filter($page.contains("wikipedia")).sum($deleted)')
        .apply('Filtered2', '$wiki.filter($page.match("^wiki")).sum($deleted)')
        .sort('$FilteredSumDeleted', 'descending')
        .limit(5);

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;

      expect(druidExternal.getQueryAndPostProcess().query).to.deep.equal({
        "aggregations": [
          {
            "aggregator": {
              "fieldName": "deleted",
              "name": "FilteredSumDeleted",
              "type": "doubleSum"
            },
            "filter": {
              "dimension": "page",
              "query": {
                "caseSensitive": true,
                "type": "contains",
                "value": "wikipedia"
              },
              "type": "search"
            },
            "name": "FilteredSumDeleted",
            "type": "filtered"
          },
          {
            "aggregator": {
              "fieldName": "deleted",
              "name": "Filtered2",
              "type": "doubleSum"
            },
            "filter": {
              "dimension": "page",
              "pattern": "^wiki",
              "type": "regex"
            },
            "name": "Filtered2",
            "type": "filtered"
          }
        ],
        "dataSource": "wikipedia",
        "dimension": {
          "dimension": "page",
          "outputName": "Page",
          "type": "default"
        },
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "metric": "FilteredSumDeleted",
        "queryType": "topN",
        "threshold": 5
      });
    });

    it("works in simple cases with power and absolute", () => {
      var ex = $('wiki').split("$page", 'Page')
        .apply('Count', '$wiki.count()')
        .apply('Abs', '$wiki.sum($added).absolute()')
        .apply('Abs2', '$wiki.sum($added).power(2)')
        .sort('$Abs', 'descending')
        .limit(5);

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query).to.deep.equal({
        "aggregations": [
          {
            "name": "Count",
            "type": "count"
          },
          {
            "fieldName": "added",
            "name": "!T_0",
            "type": "doubleSum"
          }
        ],
        "dataSource": "wikipedia",
        "dimension": {
          "dimension": "page",
          "outputName": "Page",
          "type": "default"
        },
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "metric": "Abs",
        "postAggregations": [
          {
            "fieldNames": [
              "!T_0"
            ],
            "function": "function(_$33T_0) { return Math.abs((+_$33T_0)); }",
            "name": "Abs",
            "type": "javascript"
          },
          {
            "fieldNames": [
              "!T_0"
            ],
            "function": "function(_$33T_0) { return Math.pow((+_$33T_0),2); }",
            "name": "Abs2",
            "type": "javascript"
          }
        ],
        "queryType": "topN",
        "threshold": 5
      });
    });

    it("works with complex absolute and power expressions", () => {
      var ex = $('wiki').split("$page", 'Page')
        .apply('Count', '$wiki.count()')
        .apply('Abs', '(($wiki.sum($added)/$wiki.count().absolute().power(0.5) + 100 * $wiki.countDistinct($page)).absolute()).power(2) + $wiki.custom(crazy)')
        .sort('$Count', 'descending')
        .limit(5);

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query).to.deep.equal({
        "aggregations": [
          {
            "name": "Count",
            "type": "count"
          },
          {
            "fieldName": "added",
            "name": "!T_0",
            "type": "doubleSum"
          },
          {
            "byRow": true,
            "fieldNames": [
              "page"
            ],
            "name": "!T_1",
            "type": "cardinality"
          },
          {
            "activate": false,
            "name": "!T_2",
            "the": "borg will rise again",
            "type": "crazy"
          }
        ],
        "dataSource": "wikipedia",
        "dimension": {
          "dimension": "page",
          "outputName": "Page",
          "type": "default"
        },
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "metric": "Count",
        "postAggregations": [
          {
            "fieldName": "!T_1",
            "name": "!F_!T_1",
            "type": "hyperUniqueCardinality"
          },
          {
            "fields": [
              {
                "fieldNames": [
                  "!T_0",
                  "!F_!T_1",
                  "Count"
                ],
                "function": "function(_$33T_0,_$33T_1,_Count) { return Math.pow(Math.abs((((+_$33T_0)/Math.pow(Math.abs((+_Count)),0.5))+(100*(+_$33T_1)))),2); }",
                "type": "javascript"
              },
              {
                "fieldName": "!T_2",
                "type": "getSomeCrazy"
              }
            ],
            "fn": "+",
            "name": "Abs",
            "type": "arithmetic"
          }
        ],
        "queryType": "topN",
        "threshold": 5
      });
    });

    it("works in simple cases with string comparisons", () => {
      var ex = $('wiki').filter("$page < 'moon'", 'Page')
        .limit(5);

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query).to.deep.equal({
        "dataSource": "wikipedia",
        "dimensions": [
          "sometimeLater",
          "language",
          "page",
          "tags",
          "commentLength",
          "isRobot",
          "delta_hist",
          {
            "dimension": "page",
            "extractionFn": {
              "format": "[%s]",
              "nullHandling": "returnNull",
              "type": "stringFormat"
            },
            "outputName": "pageInBrackets",
            "type": "extraction"
          }
        ],
        "filter": {
          "dimension": "page",
          "type": "bound",
          "upper": "moon",
          "upperStrict": true
        },
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "metrics": [
          "count",
          "added",
          "deleted",
          "inserted",
        ],
        "pagingSpec": {
          "pagingIdentifiers": {},
          "threshold": 5
        },
        "queryType": "select"
      });
    });

    it.skip("should work with error bound calculation", () => {
      var ex = ply()
        .apply('DistPagesWithinLimits', '($wiki.countDistinct($page) - 279893).absolute() < 10');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      console.log('ex.toString()', ex.toString());

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query).to.deep.equal({});
    });

  });


  describe("filters", () => {

    it("throws an error on unsplitable", () => {
      var ex = $('wiki').filter($("count").is(1337));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      expect(() => {
        ex.external.getQueryAndPostProcess();
      }).to.throw(`can not convert $count:NUMBER = 1337 to filter because it references an un-filterable metric 'count' which is most likely rolled up.`);
    });

    it("works with ref filter", () => {
      var ex = $('wiki').filter($("isRobot"));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "isRobot",
        "extractionFn": {
          "lookup": {
            "map": {
              "0": "false",
              "1": "true",
              "false": "false",
              "true": "true"
            },
            "type": "map"
          },
          "type": "lookup"
        },
        "type": "selector",
        "value": true
      });
    });

    it("works with ref.not() filter", () => {
      var ex = $('wiki').filter($("isRobot").not());

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "field": {
          "dimension": "isRobot",
          "extractionFn": {
            "lookup": {
              "map": {
                "0": "false",
                "1": "true",
                "false": "false",
                "true": "true"
              },
              "type": "map"
            },
            "type": "lookup"
          },
          "type": "selector",
          "value": true
        },
        "type": "not"
      });
    });

    it("works with .in(1 thing)", () => {
      var ex = $('wiki').filter($("language").in(['en']));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "language",
        "type": "selector",
        "value": "en"
      });
    });

    it("works with .in(3 things)", () => {
      var ex = $('wiki').filter($("language").in(['en', 'es', 'fr']));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "language",
        "type": "in",
        "values": ['en', 'es', 'fr']
      });
    });

    it("works with .in([null])", () => {
      var ex = $('wiki').filter($("language").in([null]));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "language",
        "type": "selector",
        "value": null
      });
    });

    it("works with .lookup().in(3 things)", () => {
      var ex = $('wiki').filter($("language").lookup('language_lookup').in(['en', 'es', 'fr']));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "language",
        "extractionFn": {
          "lookup": "language_lookup",
          "type": "registeredLookup"
        },
        "type": "in",
        "values": [
          "en",
          "es",
          "fr"
        ]
      });
    });

    it("works with .overlap([null])", () => {
      var ex = $('wiki').filter($("language").overlap([null]));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "language",
        "type": "selector",
        "value": null
      });
    });

    it("works with .lookup().overlap(blah, null) (on SET/STRING)", () => {
      var ex = $('wiki').filter($("tags").lookup('tag_lookup').overlap(['Good', null]));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "tags",
        "extractionFn": {
          "lookup": "tag_lookup",
          "type": "registeredLookup"
        },
        "type": "in",
        "values": [
          "Good",
          null
        ]
      });
    });

    it("works with .extract().overlap(blah, null) (on SET/STRING)", () => {
      var ex = $('wiki').filter($("tags").extract('[0-9]+').overlap(['Good', null]));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "tags",
        "extractionFn": {
          "expr": "[0-9]+",
          "replaceMissingValue": true,
          "type": "regex"
        },
        "type": "in",
        "values": [
          "Good",
          null
        ]
      });
    });

    it("works with .substr().overlap(blah, null) (on SET/STRING)", () => {
      var ex = $('wiki').filter($("tags").substr(1, 3).overlap(['Good', null]));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "tags",
        "extractionFn": {
          "index": 1,
          "length": 3,
          "type": "substring"
        },
        "type": "in",
        "values": [
          "Good",
          null
        ]
      });
    });

    it("works with .in(NUMBER_RANGE)", () => {
      var ex = $('wiki').filter($("commentLength").in(10, 30));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "alphaNumeric": true,
        "dimension": "commentLength",
        "lower": 10,
        "type": "bound",
        "upper": 30,
        "upperStrict": true
      });
    });

    it("works with .in(SET/NUMBER)", () => {
      var ex = $('wiki').filter($("commentLength").in([10, 30]));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "commentLength",
        "type": "in",
        "values": [10, 30]
      });
    });

    it("works with .contains()", () => {
      var ex = $('wiki').filter($("language").contains('en', 'ignoreCase'));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "language",
        "query": {
          "caseSensitive": false,
          "type": "contains",
          "value": "en"
        },
        "type": "search"
      });
    });

    it("works with SET/STRING.contains()", () => {
      var ex = $('wiki').filter($("tags").contains('good', 'ignoreCase'));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "tags",
        "query": {
          "caseSensitive": false,
          "type": "contains",
          "value": "good"
        },
        "type": "search"
      });
    });

    it("works with .lookup().contains()", () => {
      var ex = $('wiki').filter($("language").lookup('language_lookup').contains('eN', 'ignoreCase'));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "language",
        "extractionFn": {
          "lookup": "language_lookup",
          "type": "registeredLookup"
        },
        "query": {
          "caseSensitive": false,
          "type": "contains",
          "value": "eN"
        },
        "type": "search"
      });
    });

    it("works with .lookup().contains().not()", () => {
      var ex = $('wiki').filter($("language").lookup('language_lookup').contains('eN', 'ignoreCase').not());

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "field": {
          "dimension": "language",
          "extractionFn": {
            "lookup": "language_lookup",
            "type": "registeredLookup"
          },
          "query": {
            "caseSensitive": false,
            "type": "contains",
            "value": "eN"
          },
          "type": "search"
        },
        "type": "not"
      });
    });

    it("works with .concat().concat().contains()", () => {
      var ex = $('wiki').filter("('[' ++ $language ++ ']').contains('eN', 'ignoreCase')");

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "language",
        "extractionFn": {
          "format": "[%s]",
          "nullHandling": "returnNull",
          "type": "stringFormat"
        },
        "query": {
          "caseSensitive": false,
          "type": "contains",
          "value": "eN"
        },
        "type": "search"
      });
    });

    it("works with .match()", () => {
      var ex = $('wiki').filter($("language").match('en+'));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "language",
        "pattern": "en+",
        "type": "regex"
      });
    });

    it("works with SET/STRING.match()", () => {
      var ex = $('wiki').filter($("tags").match('goo+d'));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "tags",
        "pattern": "goo+d",
        "type": "regex"
      });
    });

    it("works with .timePart().in()", () => {
      var ex = $('wiki').filter($('time').timePart('HOUR_OF_DAY').in([3, 5]));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "__time",
        "extractionFn": {
          "format": "H",
          "locale": "en-US",
          "timeZone": "Etc/UTC",
          "type": "timeFormat"
        },
        "type": "in",
        "values": [
          3,
          5
        ]
      });
    });

    it("works with derived .in()", () => {
      var ex = $('wiki')
        .filter('$pageInBrackets == "[wiki]"');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "format": "[%s]",
          "nullHandling": "returnNull",
          "type": "stringFormat"
        },
        "type": "selector",
        "value": "[wiki]"
      });
    });

    it("works with dynamic derived .in()", () => {
      var ex = $('wiki')
        .apply('page3', '$page.substr(0, 3)')
        .filter('$page3 == wik');

      ex = ex.referenceCheck(context).resolve(context).simplify();


      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.filter).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "index": 0,
          "length": 3,
          "type": "substring"
        },
        "type": "selector",
        "value": "wik"
      });
    });

  });


  describe("splits (makes correct dimension extractionFns)", () => {

    it("throws an error on unsplitable", () => {
      var ex = $('wiki').split('$count', 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      expect(() => {
        ex.external.getQueryAndPostProcess();
      }).to.throw(`can not convert $count:NUMBER to split because it references an un-splitable metric 'count' which is most likely rolled up.`);
    });

    it("works with default", () => {
      var ex = $('wiki').split('$page', 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "outputName": "Split",
        "type": "default"
      });
    });

    it("works with BOOLEAN ref", () => {
      var ex = $('wiki').split('$isRobot', 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('topN');
      expect(query.dimension).to.deep.equal({
        "dimension": "isRobot",
        "extractionFn": {
          "lookup": {
            "map": {
              "0": "false",
              "1": "true",
              "false": "false",
              "true": "true"
            },
            "type": "map"
          },
          "type": "lookup"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with simple STRING", () => {
      var ex = $('wiki').split('$page', 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "outputName": "Split",
        "type": "default"
      });
    });

    it("works with dynamic derived column STRING", () => {
      var ex = $('wiki').apply('page3', '$page.substr(0, 3)').split('$page3', 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "index": 0,
          "length": 3,
          "type": "substring"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .concat()", () => {
      var ex = $('wiki').split('"[%]" ++ $page ++ "[%]"', 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "format": "[\\%]%s[\\%]",
          "nullHandling": "returnNull",
          "type": "stringFormat"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with SET/STRING.concat()", () => {
      var ex = $('wiki').split('"[%]" ++ $page ++ "[%]"', 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "format": "[\\%]%s[\\%]",
          "nullHandling": "returnNull",
          "type": "stringFormat"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .substr()", () => {
      var ex = $('wiki').split('$page.substr(3, 5)', 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "type": "substring",
          "index": 3,
          "length": 5
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .substr().extract()", () => {
      var ex = $('wiki').split('$page.substr(3, 5).extract("\\d+")', 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "extractionFns": [
            {
              "index": 3,
              "length": 5,
              "type": "substring"
            },
            {
              "expr": "\\d+",
              "replaceMissingValue": true,
              "type": "regex"
            }
          ],
          "type": "cascade"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .extract() (no fallback)", () => {
      var ex = $('wiki').split($('page').extract('^Cat(.+)$'), 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "type": "regex",
          "expr": "^Cat(.+)$",
          "replaceMissingValue": true
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .extract() with custom .fallback()", () => {
      var ex = $('wiki').split($('page').extract('^Cat(.+)$').fallback("noMatch"), 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "type": "regex",
          "expr": "^Cat(.+)$",
          "replaceMissingValue": true,
          "replaceMissingValueWith": "noMatch"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .extract() with self .fallback()", () => {
      var ex = $('wiki').split($('page').extract('^Cat(.+)$').fallback("$page"), 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "type": "regex",
          "expr": "^Cat(.+)$"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .lookup() (no fallback)", () => {
      var ex = $('wiki').split($('page').lookup('wikipedia-page-lookup'), 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "lookup": "wikipedia-page-lookup",
          "type": "registeredLookup"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .lookup() with custom .fallback()", () => {
      var ex = $('wiki').split($('page').lookup('wikipedia-page-lookup').fallback('missing'), 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "lookup": "wikipedia-page-lookup",
          "replaceMissingValueWith": "missing",
          "type": "registeredLookup"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .lookup() with self .fallback()", () => {
      var ex = $('wiki').split($('page').lookup('wikipedia-page-lookup').fallback('$page'), 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "lookup": "wikipedia-page-lookup",
          "retainMissingValue": true,
          "type": "registeredLookup"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .lookup().fallback().extract()", () => {
      var ex = $('wiki').split($('page').lookup('wikipedia-page-lookup').fallback('$page').extract("\\d+"), 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "extractionFns": [
            {
              "lookup": "wikipedia-page-lookup",
              "retainMissingValue": true,
              "type": "registeredLookup"
            },
            {
              "expr": "\\d+",
              "replaceMissingValue": true,
              "type": "regex"
            }
          ],
          "type": "cascade"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .lookup().fallback().contains()", () => {
      var ex = $('wiki').split($('page').lookup('wikipedia-page-lookup').fallback('$page').contains("lol"), 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('topN');
      expect(query.dimension).to.deep.equal({
        "dimension": "page",
        "extractionFn": {
          "extractionFns": [
            {
              "lookup": "wikipedia-page-lookup",
              "retainMissingValue": true,
              "type": "registeredLookup"
            },
            {
              "function": "function(d){var _,_2;return (_=d,(_==null)?null:((''+_).indexOf(\"lol\")>-1));}",
              "type": "javascript"
            }
          ],
          "type": "cascade"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with SET/STRING.lookup()", () => {
      var ex = $('wiki').split($('tags').lookup('tag-lookup'), 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "tags",
        "extractionFn": {
          "lookup": "tag-lookup",
          "type": "registeredLookup"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with SET/STRING.lookup().contains()", () => {
      var ex = $('wiki').split($('tags').lookup('tag-lookup').contains("lol", 'ignoreCase'), 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('topN');
      expect(query.dimension).to.deep.equal({
        "dimension": "tags",
        "extractionFn": {
          "extractionFns": [
            {
              "lookup": "tag-lookup",
              "type": "registeredLookup"
            },
            {
              "function": "function(d){var _,_2;return (_=d,(_==null)?null:((''+_).toLowerCase().indexOf((''+\"lol\").toLowerCase())>-1));}",
              "type": "javascript"
            }
          ],
          "type": "cascade"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .absolute()", () => {
      var ex = $('wiki').split("$commentLength.absolute()", 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "commentLength",
        "extractionFn": {
          "function": "function(d){var _,_2;_=Math.abs((+d));return isNaN(_)?null:_}",
          "type": "javascript"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .power()", () => {
      var ex = $('wiki').split("$commentLength.power(2)", 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "commentLength",
        "extractionFn": {
          "function": "function(d){var _,_2;_=Math.pow((+d),2);return isNaN(_)?null:_}",
          "type": "javascript"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .numberBucket()", () => {
      var ex = $('wiki').split("$commentLength.numberBucket(10, 1)", 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "commentLength",
        "extractionFn": {
          "function": "function(d){var _,_2;_=(_=(+d),(_==null?null:Math.floor((_ - 1) / 10) * 10 + 1));return isNaN(_)?null:_}",
          "type": "javascript"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .absolute().numberBucket()", () => {
      var ex = $('wiki').split("$commentLength.absolute().numberBucket(10)", 'Split');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "commentLength",
        "extractionFn": {
          "function": "function(d){var _,_2;_=(_=Math.abs((+d)),(_==null?null:Math.floor(_ / 10) * 10));return isNaN(_)?null:_}",
          "type": "javascript"
        },
        "outputName": "Split",
        "type": "extraction"
      });
    });

    it("works with .timeBucket()", () => {
      var ex = $('wiki').split({
        'Split1': "$time.timeBucket(P1D)",
        'Split2': "$sometimeLater.timeBucket(P1D)"
      });

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "sometimeLater",
        "extractionFn": {
          "format": "yyyy-MM-dd'Z",
          "locale": "en-US",
          "timeZone": "Etc/UTC",
          "type": "timeFormat"
        },
        "outputName": "Split2",
        "type": "extraction"
      });
    });

    it("works with .timePart()", () => {
      var ex = $('wiki').split({
        'Split1': "$time.timePart(DAY_OF_WEEK, 'Etc/UTC')",
        'Split2': "$sometimeLater.timePart(DAY_OF_WEEK, 'Etc/UTC')"
      });

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query.dimensions[0]).to.deep.equal({
        "dimension": "__time",
        "extractionFn": {
          "format": "e",
          "locale": "en-US",
          "timeZone": "Etc/UTC",
          "type": "timeFormat"
        },
        "outputName": "Split1",
        "type": "extraction"
      });
    });

    it("works with custom transform split with time format extraction fn", () => {
      var ex = $('wiki')
        .split($('time').customTransform('makeFrenchCanadian').cast('STRING'), 'FrenchCanadian');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query).to.deep.equal({
        "aggregations": [
          {
            "name": "!DUMMY",
            "type": "count"
          }
        ],
        "dataSource": "wikipedia",
        "dimensions": [
          {
            "dimension": "__time",
            "extractionFn": {
              "format": "EEEE",
              "locale": "fr",
              "timeZone": "America/Montreal",
              "type": "timeFormat"
            },
            "outputName": "FrenchCanadian",
            "type": "extraction"
          }
        ],
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "limitSpec": {
          "columns": [
            {
              "dimension": "FrenchCanadian"
            }
          ],
          "type": "default"
        },
        "queryType": "groupBy"
      });
    });

    it("works with custom transform split with javascript extraction fn", () => {
      var ex = $('wiki')
        .split($('time').customTransform('makeExcited'), 'Excited');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var query = ex.external.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('groupBy');
      expect(query).to.deep.equal({
        "aggregations": [
          {
            "name": "!DUMMY",
            "type": "count"
          }
        ],
        "dataSource": "wikipedia",
        "dimensions": [
          {
            "dimension": "__time",
            "extractionFn": {
              "function": "function(str) { return str + '!!!'; }",
              "type": "javascript"
            },
            "outputName": "Excited",
            "type": "extraction"
          }
        ],
        "granularity": "all",
        "intervals": "2013-02-26T00Z/2013-02-27T00Z",
        "limitSpec": {
          "columns": [
            {
              "dimension": "Excited"
            }
          ],
          "type": "default"
        },
        "queryType": "groupBy"
      });
    });
  });

  describe("applies", () => {
    it("works with ref filtered agg", () => {
      var ex = ply()
        .apply('Count', $('wiki').sum('$count'))
        .apply('Test', $('wiki').filter('$isRobot').sum('$count'));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('literal');
      var druidExternal = ex.value.getReadyExternals()[0].external;

      var query = druidExternal.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('timeseries');
      expect(query.aggregations[1]).to.deep.equal({
        "aggregator": {
          "fieldName": "count",
          "name": "Test",
          "type": "doubleSum"
        },
        "filter": {
          "dimension": "isRobot",
          "extractionFn": {
            "lookup": {
              "map": {
                "0": "false",
                "1": "true",
                "false": "false",
                "true": "true"
              },
              "type": "map"
            },
            "type": "lookup"
          },
          "type": "selector",
          "value": true
        },
        "name": "Test",
        "type": "filtered"
      });
    });

    it("works with quantile agg", () => {
      var ex = ply()
        .apply('P95', $('wiki').quantile('$delta_hist', 0.95))
        .apply('P99by2', $('wiki').quantile('$delta_hist', 0.99).divide(2));

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('literal');
      var druidExternal = ex.value.getReadyExternals()[0].external;

      var query = druidExternal.getQueryAndPostProcess().query;
      expect(query.queryType).to.equal('timeseries');
      expect(query.aggregations).to.deep.equal([
        {
          "fieldName": "delta_hist",
          "name": "!H_P95",
          "type": "approxHistogramFold"
        },
        {
          "fieldName": "delta_hist",
          "name": "!H_!T_0",
          "type": "approxHistogramFold"
        }
      ]);

      expect(query.postAggregations).to.deep.equal([
        {
          "fieldName": "!H_P95",
          "name": "P95",
          "probability": 0.95,
          "type": "quantile"
        },
        {
          "fieldName": "!H_!T_0",
          "name": "!T_0",
          "probability": 0.99,
          "type": "quantile"
        },
        {
          "fields": [
            {
              "fieldName": "!T_0",
              "type": "fieldAccess"
            },
            {
              "type": "constant",
              "value": 2
            }
          ],
          "fn": "/",
          "name": "P99by2",
          "type": "arithmetic"
        }
      ]);
    });

  });


  describe("should work when getting back [] and [{result:[]}]", () => {
    var nullExternal = External.fromJS({
      engine: 'druid',
      source: 'wikipedia',
      timeAttribute: 'time',
      allowSelectQueries: true,
      attributes: [
        { name: 'time', type: 'TIME' },
        { name: 'language', type: 'STRING' },
        { name: 'page', type: 'STRING' },
        { name: 'added', type: 'NUMBER' }
      ],
      filter: timeFilter
    }, () => Q([]));

    var emptyExternal = External.fromJS({
      engine: 'druid',
      source: 'wikipedia',
      timeAttribute: 'time',
      allowSelectQueries: true,
      attributes: [
        { name: 'time', type: 'TIME' },
        { name: 'language', type: 'STRING' },
        { name: 'page', type: 'STRING' },
        { name: 'added', type: 'NUMBER' }
      ],
      filter: timeFilter
    }, ({ query }) => {
      if (query.queryType === 'select') {
        return Q([
          {
            "timestamp": "2016-03-15T23:00:00.458Z",
            "result": {
              "pagingIdentifiers": {
                "wikipedia_2016-03-15T23:00:00.000Z_2016-03-16T00:00:00.000Z_2016-03-15T23:00:00.000Z": 0
              },
              "events": []
            }
          }
        ]);
      } else {
        return Q([{ result: [] }]);
      }
    });

    describe("should return null correctly on a totals query", () => {
      var ex = ply()
        .apply('Count', '$wiki.count()');

      it("works with [] return", () => {
        return ex.compute({ wiki: nullExternal })
          .then((result) => {
            expect(result.toJS()).to.deep.equal([
              { Count: 0 }
            ]);
          });
      });
    });

    describe("should return null correctly on a timeseries query", () => {
      var ex = $('wiki').split("$time.timeBucket(P1D, 'Etc/UTC')", 'Time')
        .apply('Count', '$wiki.count()')
        .sort('$Time', 'ascending');

      it("works with [] return", () => {
        return ex.compute({ wiki: nullExternal })
          .then((result) => {
            expect(result.toJS()).to.deep.equal([]);
          });
      });
    });

    describe("should return null correctly on a topN query", () => {
      var ex = $('wiki').split("$page", 'Page')
        .apply('Count', '$wiki.count()')
        .apply('Added', '$wiki.sum($added)')
        .sort('$Count', 'descending')
        .limit(5);

      it("works with [] return", () => {
        return ex.compute({ wiki: nullExternal })
          .then((result) => {
            expect(result.toJS()).to.deep.equal([]);
          });
      });

      it("works with [{result:[]}] return", () => {
        return ex.compute({ wiki: emptyExternal })
          .then((result) => {
            expect(result.toJS()).to.deep.equal([]);
          });
      });
    });

    describe("should return null correctly on a select query", () => {
      var ex = $('wiki');

      it("works with [] return", () => {
        return ex.compute({ wiki: nullExternal })
          .then((result) => {
            expect(AttributeInfo.toJSs(result.attributes)).to.deep.equal([
              { name: 'time', type: 'TIME' },
              { name: 'language', type: 'STRING' },
              { name: 'page', type: 'STRING' },
              { name: 'added', type: 'NUMBER' }
            ]);

            expect(result.toJS()).to.deep.equal([]);
            expect(result.toCSV()).to.equal('time,language,page,added');
          });
      });

      it("works with [{result:[]}] return", () => {
        return ex.compute({ wiki: emptyExternal })
          .then((result) => {
            expect(AttributeInfo.toJSs(result.attributes)).to.deep.equal([
              { name: 'time', type: 'TIME' },
              { name: 'language', type: 'STRING' },
              { name: 'page', type: 'STRING' },
              { name: 'added', type: 'NUMBER' }
            ]);

            expect(result.toJS()).to.deep.equal([]);
            expect(result.toCSV()).to.equal('time,language,page,added');
          });
      });
    });
  });


  describe("should work when getting back crap data", () => {
    var crapExternal = External.fromJS({
      engine: 'druid',
      source: 'wikipedia',
      timeAttribute: 'time',
      attributes: [
        { name: 'time', type: 'TIME' },
        { name: 'language', type: 'STRING' },
        { name: 'page', type: 'STRING' },
        { name: 'added', type: 'NUMBER' }
      ],
      filter: timeFilter
    }, (query) => Q("[Does this look like data to you?"));

    it("works with value query", () => {
      var ex = ply()
        .apply('Count', '$wiki.count()');

      return ex.compute({ wiki: crapExternal })
        .then(() => {
          throw new Error('DID_NOT_ERROR');
        })
        .catch((err) => {
          expect(err.message).to.equal('unexpected result from Druid (all / value)');
        });
    });

    it("works with all query", () => {
      var ex = ply()
        .apply('Count', '$wiki.count()')
        .apply('Added', '$wiki.sum($added)');

      return ex.compute({ wiki: crapExternal })
        .then(() => {
          throw new Error('DID_NOT_ERROR');
        })
        .catch((err) => {
          expect(err.message).to.equal('unexpected result from Druid (all)');
        });
    });

    it("works with timeseries query", () => {
      var ex = $('wiki').split("$time.timeBucket(P1D, 'Etc/UTC')", 'Time')
        .apply('Count', '$wiki.count()')
        .sort('$Time', 'ascending');

      return ex.compute({ wiki: crapExternal })
        .then(() => {
          throw new Error('DID_NOT_ERROR');
        })
        .catch((err) => {
          expect(err.message).to.equal('unexpected result from Druid (timeseries)');
        });
    });

  });


  describe("should work well with druid context", () => {
    it("should pass the context", () => {
      var external = External.fromJS({
        engine: 'druid',
        source: 'wikipedia',
        timeAttribute: 'time',
        attributes: [
          { name: 'time', type: 'TIME' },
          { name: 'page', type: 'STRING' }
        ],
        filter: timeFilter,
        context: {
          hello: "world"
        }
      });

      var context = { wiki: external };

      var ex = $('wiki').split("$page", 'Page');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.context).to.deep.equal({
        hello: "world"
      })
    });

    it("should set skipEmptyBuckets on timeseries", () => {
      var external = External.fromJS({
        engine: 'druid',
        source: 'wikipedia',
        timeAttribute: 'time',
        attributes: [
          { name: 'time', type: 'TIME' },
          { name: 'page', type: 'STRING' }
        ],
        filter: timeFilter
      });

      var context = { wiki: external };

      var ex = $('wiki').split("$time.timeBucket(P1D, 'Etc/UTC')", 'T');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.context).to.deep.equal({
        skipEmptyBuckets: "true"
      })
    });

    it("should respect skipEmptyBuckets already set on context", () => {
      var external = External.fromJS({
        engine: 'druid',
        source: 'wikipedia',
        timeAttribute: 'time',
        attributes: [
          { name: 'time', type: 'TIME' },
          { name: 'page', type: 'STRING' }
        ],
        filter: timeFilter,
        context: {
          skipEmptyBuckets: "false"
        }
      });

      var context = { wiki: external };

      var ex = $('wiki').split("$time.timeBucket(P1D, 'Etc/UTC')", 'T');

      ex = ex.referenceCheck(context).resolve(context).simplify();

      expect(ex.op).to.equal('external');
      var druidExternal = ex.external;
      expect(druidExternal.getQueryAndPostProcess().query.context).to.deep.equal({
        skipEmptyBuckets: "false"
      })
    });

  });

});
