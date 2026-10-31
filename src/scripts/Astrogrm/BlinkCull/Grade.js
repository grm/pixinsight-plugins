// Notation des poses, sans interface et sans mesure.
// Chaque light est comparée à sa cohorte : même instrument, filtre, temps de pose et nuit.
// Si les pointages s'écartent, la cohorte est aussi découpée par tuile de ciel.

var BLINK_MOODS = {
   lenient: {
      id: "lenient",
      label: "Souple",
      starFrac: 0.35,
      kSoft: 4.0,
      kTrail: 4.0,
      eccAbs: 0.72,
      skyRatio: 3.0
   },
   standard: {
      id: "standard",
      label: "Standard",
      starFrac: 0.55,
      kSoft: 3.0,
      kTrail: 3.0,
      eccAbs: 0.60,
      skyRatio: 3.0
   },
   strict: {
      id: "strict",
      label: "Strict",
      starFrac: 0.70,
      kSoft: 2.0,
      kTrail: 2.2,
      eccAbs: 0.50,
      skyRatio: 3.0
   }
};

function blinkMedian( values )
{
   let v = [];
   for ( let i = 0; i < values.length; ++i )
      if ( isFinite( values[ i ] ) )
         v.push( values[ i ] );
   if ( v.length == 0 )
      return NaN;
   v.sort( function( a, b ) { return a - b; } );
   let mid = Math.floor( v.length / 2 );
   if ( v.length % 2 )
      return v[ mid ];
   return ( v[ mid - 1 ] + v[ mid ] ) / 2;
}

function blinkMad( values, med )
{
   let dev = [];
   for ( let i = 0; i < values.length; ++i )
      if ( isFinite( values[ i ] ) )
         dev.push( Math.abs( values[ i ] - med ) );
   return blinkMedian( dev );
}

function blinkSigma( values )
{
   let med = blinkMedian( values );
   let mad = blinkMad( values, med );
   return {
      median: med,
      mad: mad,
      sigma: ( mad > 0 ) ? 1.4826 * mad : 0
   };
}

function blinkUpperReference( values )
{
   let v = [];
   for ( let i = 0; i < values.length; ++i )
      if ( isFinite( values[ i ] ) )
         v.push( values[ i ] );
   if ( v.length == 0 )
      return NaN;
   v.sort( function( a, b ) { return a - b; } );
   return blinkMedian( v.slice( Math.floor( v.length / 2 ) ) );
}

function blinkLowerReference( values )
{
   let v = [];
   for ( let i = 0; i < values.length; ++i )
      if ( isFinite( values[ i ] ) )
         v.push( values[ i ] );
   if ( v.length == 0 )
      return NaN;
   v.sort( function( a, b ) { return a - b; } );
   return blinkMedian( v.slice( 0, Math.max( 1, Math.ceil( v.length / 2 ) ) ) );
}

function blinkBright( measure )
{
   if ( !measure )
      return NaN;
   if ( isFinite( measure.mstar ) && measure.mstar > 0 )
      return measure.mstar;
   if ( isFinite( measure.psfSignal ) && measure.psfSignal > 0 )
      return measure.psfSignal;
   return NaN;
}

function blinkGrain( measure )
{
   if ( !measure || !isFinite( measure.noise ) || !isFinite( measure.median ) )
      return NaN;
   let sky = Math.max( measure.median, 1e-8 );
   return measure.noise / Math.sqrt( sky );
}

function blinkZHigh( value, stats )
{
   if ( !isFinite( value ) || !stats || !isFinite( stats.median ) )
      return 0;
   if ( stats.sigma > 0 )
      return ( value - stats.median ) / stats.sigma;
   if ( !( value > stats.median ) )
      return 0;
   if ( stats.median > 0 )
      return ( value / stats.median - 1 ) * 3;
   return 3;
}

function assignCohorts( frames, options )
{
   options = options || {};
   let bin = options.pointingBinDeg || 0.5;
   let spread = options.pointingSpreadDeg || 0.6;
   let lights = [];
   for ( let i = 0; i < frames.length; ++i )
      if ( frames[ i ].kind == "light" && isFinite( frames[ i ].ra ) && isFinite( frames[ i ].dec ) )
         lights.push( frames[ i ] );

   let usePointing = false;
   if ( lights.length >= 2 )
   {
      let ras = lights.map( function( f ) { return f.ra; } );
      let decs = lights.map( function( f ) { return f.dec; } );
      let decMed = blinkMedian( decs );
      let raSpan = ( Math.max.apply( null, ras ) - Math.min.apply( null, ras ) ) * Math.cos( decMed * Math.PI / 180 );
      let decSpan = Math.max.apply( null, decs ) - Math.min.apply( null, decs );
      usePointing = Math.abs( raSpan ) > spread || decSpan > spread;
   }

   for ( let i = 0; i < frames.length; ++i )
   {
      let f = frames[ i ];
      if ( f.kind != "light" )
      {
         f.cohort = "";
         continue;
      }
      let point = "champ";
      if ( usePointing )
      {
         if ( isFinite( f.ra ) && isFinite( f.dec ) )
            point = Math.round( f.ra / bin ) + ":" + Math.round( f.dec / bin );
         else
            point = "sans-pointage";
      }
      let exposure = isFinite( f.exposure ) ? Number( f.exposure ).toFixed( 2 ) : "?";
      f.baseCohort = [ f.instrument || "?", f.filter || "?", exposure, f.night || "?" ].join( "|" );
      f.pointingKey = point;
      f.cohort = f.baseCohort + "|" + point;
   }
   return usePointing;
}

function effectiveVerdict( frame )
{
   if ( frame.override == "keep" || frame.override == "reject" )
      return frame.override;
   return frame.autoVerdict || "unread";
}

function gradeCohort( group, mood, reference )
{
   let measured = [];
   for ( let i = 0; i < group.length; ++i )
   {
      let f = group[ i ];
      if ( !f.measure || f.measure.failed || !( f.measure.stars > 0 ) )
      {
         f.autoVerdict = "unread";
         f.autoReason = "illisible";
         f.score = 0;
      }
      else
         measured.push( f );
   }
   if ( measured.length == 0 )
      return;

   let refMeasured = measured;
   if ( reference )
   {
      refMeasured = [];
      for ( let i = 0; i < reference.length; ++i )
      {
         let f = reference[ i ];
         if ( f.measure && !f.measure.failed && f.measure.stars > 0 )
            refMeasured.push( f );
      }
   }

   if ( !reference && measured.length == 1 )
   {
      let only = measured[ 0 ];
      only.autoVerdict = "keep";
      only.autoReason = "";
      only.score = 100;
      applyAbsolute( only, mood );
      return;
   }

   if ( refMeasured.length < 2 )
   {
      for ( let i = 0; i < measured.length; ++i )
      {
         measured[ i ].autoVerdict = "keep";
         measured[ i ].autoReason = "";
         measured[ i ].score = 100;
         applyAbsolute( measured[ i ], mood );
      }
      return;
   }

   let starRef = blinkUpperReference( refMeasured.map( function( f ) { return f.measure.stars; } ) );
   let brightRef = blinkUpperReference( refMeasured.map( function( f ) { return blinkBright( f.measure ); } ) );
   let skyRef = blinkLowerReference( refMeasured.map( function( f ) { return f.measure.median; } ) );
   let fwhmStats = blinkSigma( refMeasured.map( function( f ) { return f.measure.fwhm; } ) );
   let eccStats = blinkSigma( refMeasured.map( function( f ) { return f.measure.eccentricity; } ) );
   let grainStats = blinkSigma( refMeasured.map( function( f ) { return blinkGrain( f.measure ); } ) );
   let relative = refMeasured.length >= 4;

   for ( let i = 0; i < measured.length; ++i )
   {
      let f = measured[ i ];
      let reasons = [];
      let verdict = "keep";

      function worsen( next, reason )
      {
         if ( next == "reject" || ( next == "review" && verdict == "keep" ) )
            verdict = next;
         if ( reason && reasons.indexOf( reason ) < 0 )
            reasons.push( reason );
      }

      let stars = f.measure.stars;
      let bright = blinkBright( f.measure );
      if ( relative && starRef > 0 && stars < mood.starFrac * starRef )
      {
         let brightFell = isFinite( bright ) && brightRef > 0 && bright < 0.65 * brightRef;
         if ( brightFell )
            worsen( "reject", "nuage ou voile" );
         else if ( !isFinite( bright ) && stars < 0.35 * starRef )
            worsen( "review", "peu d'étoiles" );
         else if ( stars < 0.35 * starRef )
            worsen( "review", "peu d'étoiles" );
      }

      if ( isFinite( f.measure.eccentricity ) && f.measure.eccentricity >= mood.eccAbs )
         worsen( "reject", "filé" );
      else if ( relative )
      {
         let zE = blinkZHigh( f.measure.eccentricity, eccStats );
         if ( zE > mood.kTrail && f.measure.eccentricity > 0.42 )
            worsen( "review", "étoiles allongées" );
      }

      if ( relative )
      {
         let zF = blinkZHigh( f.measure.fwhm, fwhmStats );
         if ( zF > mood.kSoft )
            worsen( "reject", "flou" );
         else if ( zF > mood.kSoft * 0.7 )
            worsen( "review", "étoiles molles" );
      }

      if ( refMeasured.length >= 2 && skyRef > 0 && isFinite( f.measure.median ) && f.measure.median > mood.skyRatio * skyRef )
         worsen( "reject", "fond de ciel trop clair" );

      if ( relative )
      {
         let zG = blinkZHigh( blinkGrain( f.measure ), grainStats );
         if ( zG > mood.kSoft + 2 )
            worsen( "reject", "grain anormal" );
         else if ( zG > mood.kSoft )
            worsen( "review", "grain élevé" );
      }

      f.autoVerdict = verdict;
      f.autoReason = reasons.join( " ; " );
      f.score = blinkScore( f, mood, {
         starRef: starRef,
         brightRef: brightRef,
         skyRef: skyRef,
         fwhmStats: fwhmStats,
         eccStats: eccStats,
         grainStats: grainStats
      } );
   }
}

function applyAbsolute( frame, mood )
{
   if ( isFinite( frame.measure.eccentricity ) && frame.measure.eccentricity >= mood.eccAbs )
   {
      frame.autoVerdict = "reject";
      frame.autoReason = "filé";
      frame.score = Math.min( frame.score, 40 );
   }
}

function blinkScore( frame, mood, ref )
{
   let stars = frame.measure.stars;
   let starPen = 0;
   if ( ref.starRef > 0 )
      starPen = Math.max( 0, ( ref.starRef - stars ) / ref.starRef );
   let bright = blinkBright( frame.measure );
   let brightPen = 0;
   if ( ref.brightRef > 0 && isFinite( bright ) )
      brightPen = Math.max( 0, ( ref.brightRef - bright ) / ref.brightRef );
   let skyPen = 0;
   if ( ref.skyRef > 0 && isFinite( frame.measure.median ) )
      skyPen = Math.max( 0, ( frame.measure.median / ref.skyRef - 1 ) / Math.max( mood.skyRatio - 1, 0.5 ) );
   let softPen = Math.max( 0, blinkZHigh( frame.measure.fwhm, ref.fwhmStats ) / Math.max( mood.kSoft, 0.5 ) );
   let trailPen = Math.max( 0, blinkZHigh( frame.measure.eccentricity, ref.eccStats ) / Math.max( mood.kTrail, 0.5 ) );
   let raw = 100 - 22 * starPen - 18 * brightPen - 16 * skyPen - 16 * softPen - 16 * trailPen;
   if ( !isFinite( raw ) )
      raw = 0;
   raw = Math.max( 0, Math.min( 100, raw ) );
   if ( frame.autoVerdict == "reject" )
      raw = Math.min( raw, 45 );
   else if ( frame.autoVerdict == "review" )
      raw = Math.min( raw, 78 );
   return Math.round( raw );
}

function protectUncoveredPointings( frames )
{
   let bins = {};
   for ( let i = 0; i < frames.length; ++i )
   {
      let f = frames[ i ];
      if ( f.kind != "light" || f.pointingKey == null || f.pointingKey == "champ" || f.pointingKey == "sans-pointage" )
         continue;
      let key = ( f.baseCohort || "" ) + "|" + f.pointingKey;
      if ( !bins[ key ] )
         bins[ key ] = [];
      bins[ key ].push( f );
   }
   for ( let key in bins )
   {
      if ( !bins.hasOwnProperty( key ) )
         continue;
      let bin = bins[ key ];
      let covered = false;
      for ( let i = 0; i < bin.length; ++i )
         if ( bin[ i ].autoVerdict == "keep" )
            covered = true;
      if ( covered )
         continue;
      for ( let i = 0; i < bin.length; ++i )
      {
         let f = bin[ i ];
         if ( f.autoVerdict != "reject" )
            continue;
         f.autoVerdict = "review";
         let note = "aucun autre cadre ne couvre ce pointage";
         f.autoReason = f.autoReason ? ( f.autoReason + " ; " + note ) : note;
         if ( isFinite( f.score ) )
            f.score = Math.max( f.score, 50 );
      }
   }
}

function gradeAll( frames, mood )
{
   let usePointing = assignCohorts( frames );
   if ( !usePointing )
   {
      let groups = {};
      let order = [];
      for ( let i = 0; i < frames.length; ++i )
      {
         let f = frames[ i ];
         if ( f.kind != "light" )
            continue;
         if ( !groups[ f.cohort ] )
         {
            groups[ f.cohort ] = [];
            order.push( f.cohort );
         }
         groups[ f.cohort ].push( f );
      }
      for ( let i = 0; i < order.length; ++i )
         gradeCohort( groups[ order[ i ] ], mood );
      return false;
   }

   let bases = {};
   let baseOrder = [];
   for ( let i = 0; i < frames.length; ++i )
   {
      let f = frames[ i ];
      if ( f.kind != "light" )
         continue;
      if ( !bases[ f.baseCohort ] )
      {
         bases[ f.baseCohort ] = [];
         baseOrder.push( f.baseCohort );
      }
      bases[ f.baseCohort ].push( f );
   }
   for ( let b = 0; b < baseOrder.length; ++b )
   {
      let all = bases[ baseOrder[ b ] ];
      let byPoint = {};
      let points = [];
      for ( let i = 0; i < all.length; ++i )
      {
         let key = all[ i ].pointingKey || "champ";
         if ( !byPoint[ key ] )
         {
            byPoint[ key ] = [];
            points.push( key );
         }
         byPoint[ key ].push( all[ i ] );
      }
      for ( let p = 0; p < points.length; ++p )
      {
         let group = byPoint[ points[ p ] ];
         if ( group.length >= 4 )
            gradeCohort( group, mood );
         else
            gradeCohort( group, mood, all );
      }
   }
   protectUncoveredPointings( frames );
   return true;
}

function verdictLabel( verdict )
{
   if ( verdict == "keep" )
      return "Gardée";
   if ( verdict == "review" )
      return "À revoir";
   if ( verdict == "reject" )
      return "Écartée";
   return "Illisible";
}

function wbppLauncherSource( opts )
{
   let dir = opts.bppDir.replace( /\\/g, "/" );
   let files = opts.files || [];
   let lines = [];
   lines.push( "#engine v8" );
   lines.push( "#include \"" + dir + "/BPP-Global.js\"" );
   lines.push( "#include \"" + dir + "/BPP-Helper.js\"" );
   lines.push( "#include \"" + dir + "/BPP-Automation.js\"" );
   lines.push( "#include \"" + dir + "/BPP-Engine.js\"" );
   lines.push( "#include \"" + dir + "/BPP-GUI.js\"" );
   lines.push( "" );
   lines.push( "engine.id = BPP.Version.WBPP_ID;" );
   lines.push( "engine.title = BPP.Version.WBPP_TITLE;" );
   lines.push( "engine.version = BPP.Version.WBPP_VERSION;" );
   lines.push( "engine.fastMode = false;" );
   lines.push( "engine.loadSettingsKeyBase = BPP.Version.WBPP_SETTINGS_KEY_BASE;" );
   lines.push( "engine.saveSettingsKeyBase = BPP.Version.WBPP_SETTINGS_KEY_BASE;" );
   lines.push( "try { engine.parametersManager.loadSettings(); } catch ( x ) { console.warningln( x.message ); }" );
   lines.push( "engine.groupsManager.clear();" );
   lines.push( "engine.outputDirectory = " + JSON.stringify( opts.outputDirectory ) + ";" );
   lines.push( "var blinkFiles = " + JSON.stringify( files ) + ";" );
   lines.push( "var blinkFailed = 0;" );
   lines.push( "for ( var i = 0; i < blinkFiles.length; ++i )" );
   lines.push( "{" );
   lines.push( "   var added = engine.addFile( blinkFiles[ i ] );" );
   lines.push( "   if ( !added || added.success == false )" );
   lines.push( "   {" );
   lines.push( "      ++blinkFailed;" );
   lines.push( "      console.warningln( \"Fichier ignoré : \", blinkFiles[ i ], added && added.message ? \" (\" + added.message + \")\" : \"\" );" );
   lines.push( "   }" );
   lines.push( "}" );
   lines.push( "engine.rebuild();" );
   lines.push( "console.noteln( \"Poses chargées : \", blinkFiles.length - blinkFailed, \" / \", blinkFiles.length );" );
   lines.push( "for ( ;; )" );
   lines.push( "{" );
   lines.push( "   var dialog = new StackDialog();" );
   lines.push( "   dialog.updateControls();" );
   lines.push( "   if ( !dialog.execute() )" );
   lines.push( "      break;" );
   lines.push( "   engine.diagnosticsManager.runDiagnostics();" );
   lines.push( "   if ( !engine.diagnosticsManager.hasDiagnosticMessages() || engine.diagnosticsManager.showDiagnosticMessages( true ) )" );
   lines.push( "   {" );
   lines.push( "      console.show();" );
   lines.push( "      engine.cleanProcessLog();" );
   lines.push( "      engine.pipelineManager.initializeExecution();" );
   lines.push( "      engine.pipelineManager.buildExecutionPipeline();" );
   lines.push( "      engine.pipelineManager.runPipeline();" );
   lines.push( "      engine.pipelineManager.postExecutionActions();" );
   lines.push( "      engine.consoleLogger.stopLogging();" );
   lines.push( "      engine.showProcessLogs();" );
   lines.push( "   }" );
   lines.push( "   engine.diagnosticsManager.clearDiagnosticMessages();" );
   lines.push( "   CoreApplication.processEvents();" );
   lines.push( "}" );
   lines.push( "" );
   return lines.join( "\n" );
}
