// Lecture du dossier, mesures, déplacement des fichiers.

var BLINK_IMAGE_EXT = {
   ".fit": true,
   ".fits": true,
   ".fts": true,
   ".xisf": true
};

function blinkExtension( filePath )
{
   let name = File.extractName( filePath ).toLowerCase();
   if ( name.endsWith( ".fits.fz" ) || name.endsWith( ".fit.fz" ) )
      return ".fits";
   return File.extractExtension( filePath ).toLowerCase();
}

function blinkIsImage( filePath )
{
   let name = File.extractName( filePath ).toLowerCase();
   if ( name.endsWith( ".fits.fz" ) || name.endsWith( ".fit.fz" ) )
      return true;
   return !!BLINK_IMAGE_EXT[ File.extractExtension( filePath ).toLowerCase() ];
}

function blinkSkipDirectory( name )
{
   let n = name.toLowerCase();
   return n == "rejected" || n == "wbpp" || n == "wbpp-output" || n.charAt( 0 ) == ".";
}

function blinkRelative( root, filePath )
{
   let base = root.replace( /\/+$/, "" );
   if ( filePath.indexOf( base + "/" ) == 0 )
      return filePath.substring( base.length + 1 );
   return File.extractName( filePath );
}

function blinkKeywordTable( filePath )
{
   let table = {};
   let format = new FileFormat( blinkExtension( filePath ), true /*toRead*/ );
   let instance = new FileFormatInstance( format );
   let descriptions = instance.open( filePath, "verbosity 0" );
   if ( descriptions == null )
      throw new Error( "Ouverture impossible : " + filePath );
   try
   {
      let keywords = instance.keywords;
      for ( let i = 0; i < keywords.length; ++i )
      {
         let kw = keywords[ i ];
         if ( !kw || !kw.name )
            continue;
         table[ kw.name.toUpperCase() ] = kw.isNumeric ? String( kw.numericValue ) : kw.strippedValue;
      }
   }
   finally
   {
      instance.close();
   }
   return table;
}

function blinkNumber( text )
{
   if ( text == null || text === "" )
      return NaN;
   let n = parseFloat( String( text ).replace( ",", "." ) );
   return isFinite( n ) ? n : NaN;
}

function blinkSexagesimal( text, hours )
{
   if ( text == null )
      return NaN;
   let t = String( text ).trim();
   let m = t.match( /([+-]?\d+(?:\.\d+)?)[:\s]+(\d+(?:\.\d+)?)[:\s]+(\d+(?:\.\d+)?)/ );
   if ( !m )
      return NaN;
   let value = parseFloat( m[ 1 ] ) + parseFloat( m[ 2 ] ) / 60 + parseFloat( m[ 3 ] ) / 3600;
   return hours ? value * 15 : value;
}

function blinkRightAscension( kw )
{
   let cr = blinkNumber( kw.CRVAL1 );
   let ctype = ( kw.CTYPE1 || "" ).toUpperCase();
   if ( isFinite( cr ) && ( ctype.indexOf( "RA" ) >= 0 || ctype == "" ) )
      return cr;
   let sex = blinkSexagesimal( kw.OBJCTRA || kw.RA, true );
   if ( isFinite( sex ) )
      return sex;
   let ra = blinkNumber( kw.RA );
   if ( isFinite( ra ) && ra >= 0 && ra <= 360 )
      return ra;
   return NaN;
}

function blinkDeclination( kw )
{
   let cr = blinkNumber( kw.CRVAL2 );
   let ctype = ( kw.CTYPE2 || "" ).toUpperCase();
   if ( isFinite( cr ) && ( ctype.indexOf( "DEC" ) >= 0 || ctype == "" ) )
      return cr;
   let sex = blinkSexagesimal( kw.OBJCTDEC || kw.DEC, false );
   if ( isFinite( sex ) )
      return sex;
   let dec = blinkNumber( kw.DEC );
   if ( isFinite( dec ) && dec >= -90 && dec <= 90 )
      return dec;
   return NaN;
}

function blinkKindFromName( filePath )
{
   let s = filePath.toLowerCase();
   if ( s.indexOf( "darkflat" ) >= 0 || s.indexOf( "dark-flat" ) >= 0 || s.indexOf( "flatdark" ) >= 0 )
      return "darkflat";
   if ( s.indexOf( "bias" ) >= 0 || s.indexOf( "offset" ) >= 0 )
      return "bias";
   if ( s.indexOf( "flat" ) >= 0 )
      return "flat";
   if ( s.indexOf( "dark" ) >= 0 )
      return "dark";
   return "light";
}

function blinkClassify( kw, filePath )
{
   let imagetyp = ( kw.IMAGETYP || "" ).toUpperCase();
   let stack = blinkNumber( kw.STACKCNT );
   if ( !( stack > 1 ) )
      stack = blinkNumber( kw.NCOMBINE );
   let kind = "light";
   if ( imagetyp.indexOf( "DARK" ) >= 0 && imagetyp.indexOf( "FLAT" ) >= 0 )
      kind = "darkflat";
   else if ( imagetyp.indexOf( "BIAS" ) >= 0 || imagetyp.indexOf( "OFFSET" ) >= 0 )
      kind = "bias";
   else if ( imagetyp.indexOf( "FLAT" ) >= 0 )
      kind = "flat";
   else if ( imagetyp.indexOf( "DARK" ) >= 0 )
      kind = "dark";
   else if ( imagetyp.indexOf( "LIGHT" ) >= 0 )
      kind = "light";
   else if ( imagetyp.length == 0 )
      kind = blinkKindFromName( filePath );

   let name = File.extractName( filePath );
   let masterName = /master|integration|stacked/i.test( name );
   let isMaster = imagetyp.indexOf( "MASTER" ) >= 0 || stack > 1 || masterName;
   if ( isMaster && kind == "light" )
      kind = "master";
   return kind;
}

function blinkNight( dateObs )
{
   if ( !dateObs )
      return "?";
   let m = String( dateObs ).match( /(\d{4}-\d{2}-\d{2})/ );
   return m ? m[ 1 ] : "?";
}

function BlinkSession()
{
   this.root = "";
   this.frames = [];
   this.moves = [];
   this.measured = false;
}

BlinkSession.prototype.manifestPath = function()
{
   return this.root.replace( /\/+$/, "" ) + "/blink-cull-session.json";
};

BlinkSession.prototype.loadManifest = function()
{
   this.moves = [];
   let path = this.manifestPath();
   if ( !File.exists( path ) )
      return;
   try
   {
      let parsed = JSON.parse( File.readTextFile( path ) );
      if ( parsed && parsed.moves )
         this.moves = parsed.moves;
   }
   catch ( x )
   {
      console.warningln( "Manifeste illisible : ", x.message );
   }
};

BlinkSession.prototype.saveManifest = function()
{
   if ( !this.root )
      return;
   let text = JSON.stringify( { moves: this.moves }, null, 2 );
   File.writeTextFile( this.manifestPath(), text );
};

BlinkSession.prototype.scan = function( root, onProgress )
{
   this.root = root.replace( /\/+$/, "" );
   this.frames = [];
   this.measured = false;
   this.loadManifest();
   let self = this;
   let pending = [ this.root ];
   let seen = 0;
   while ( pending.length > 0 )
   {
      if ( Console.abortRequested )
         throw new Error( "Analyse interrompue." );
      let dir = pending.pop();
      let find = new FileFind;
      if ( !find.begin( dir + "/*" ) )
         continue;
      do
      {
         if ( find.name == "." || find.name == ".." )
            continue;
         let full = dir + "/" + find.name;
         if ( find.isDirectory )
         {
            if ( !blinkSkipDirectory( find.name ) )
               pending.push( full );
            continue;
         }
         if ( !blinkIsImage( full ) )
            continue;
         ++seen;
         if ( onProgress && ( seen % 15 ) == 0 )
            onProgress( seen, full );
         try
         {
            self.frames.push( self.makeFrame( full ) );
         }
         catch ( x )
         {
            console.warningln( "Ignoré : ", full, " — ", x.message );
         }
      } while ( find.next() );
   }
   this.frames.sort( function( a, b )
   {
      let da = a.dateObs || "";
      let db = b.dateObs || "";
      if ( da < db )
         return -1;
      if ( da > db )
         return 1;
      if ( a.path < b.path )
         return -1;
      if ( a.path > b.path )
         return 1;
      return 0;
   } );
   return this.frames.length;
};

BlinkSession.prototype.makeFrame = function( filePath )
{
   let kw = blinkKeywordTable( filePath );
   let exposure = blinkNumber( kw.EXPTIME );
   if ( !isFinite( exposure ) )
      exposure = blinkNumber( kw.EXPOSURE );
   let filter = kw.FILTER || "";
   if ( !filter && kw.BAYERPAT )
      filter = "OSC";
   if ( !filter )
      filter = "NoFilter";
   return {
      path: filePath,
      rel: blinkRelative( this.root, filePath ),
      kind: blinkClassify( kw, filePath ),
      filter: filter,
      exposure: exposure,
      night: blinkNight( kw[ "DATE-OBS" ] || kw.DATEOBS || "" ),
      dateObs: kw[ "DATE-OBS" ] || kw.DATEOBS || "",
      instrument: kw.INSTRUME || kw.CAMERA || "?",
      object: kw.OBJECT || "",
      ra: blinkRightAscension( kw ),
      dec: blinkDeclination( kw ),
      measure: null,
      override: null,
      autoVerdict: "",
      autoReason: "",
      score: null,
      cohort: ""
   };
};

BlinkSession.prototype.lights = function()
{
   let out = [];
   for ( let i = 0; i < this.frames.length; ++i )
      if ( this.frames[ i ].kind == "light" )
         out.push( this.frames[ i ] );
   return out;
};

BlinkSession.prototype.measure = function( onProgress )
{
   let lights = this.lights();
   if ( lights.length == 0 )
      return 0;
   console.show();
   Console.abortEnabled = true;
   let SS = new SubframeSelector;
   SS.routine = SubframeSelector.MeasureSubframes;
   SS.nonInteractive = true;
   SS.cameraResolution = SubframeSelector.Bits16;
   SS.scaleUnit = ( SubframeSelector.Pixel != undefined ) ? SubframeSelector.Pixel : SubframeSelector.ArcSeconds;
   SS.dataUnit = SubframeSelector.DataNumber;
   SS.fileCache = true;
   SS.noNoiseAndSignalWarnings = true;
   let rows = [];
   for ( let i = 0; i < lights.length; ++i )
      rows.push( [ true, lights[ i ].path, "", "" ] );
   SS.subframes = rows;
   if ( onProgress )
      onProgress( 0, lights.length );
   let success = SS.executeGlobal();
   if ( !success )
      throw new Error( "La mesure des poses a échoué." );

   let byPath = {};
   for ( let i = 0; i < lights.length; ++i )
      byPath[ lights[ i ].path ] = lights[ i ];

   for ( let i = 0; i < SS.measurements.length; ++i )
   {
      let row = SS.measurements[ i ];
      let filePath = row[ 3 ];
      let frame = byPath[ filePath ];
      if ( !frame )
         continue;
      let stars = row[ 14 ];
      frame.measure = {
         failed: !( stars > 0 ) || !isFinite( row[ 5 ] ),
         fwhm: row[ 5 ],
         eccentricity: row[ 6 ],
         psfSignal: row[ 7 ],
         snr: row[ 9 ],
         median: row[ 10 ],
         mad: row[ 11 ],
         noise: row[ 12 ],
         stars: stars,
         mstar: row[ 26 ]
      };
   }
   for ( let i = 0; i < lights.length; ++i )
      if ( !lights[ i ].measure )
         lights[ i ].measure = { failed: true, stars: 0, fwhm: NaN, eccentricity: NaN, median: NaN, noise: NaN, mstar: NaN, psfSignal: NaN, snr: NaN, mad: NaN };
   this.measured = true;
   if ( onProgress )
      onProgress( lights.length, lights.length );
   return lights.length;
};

BlinkSession.prototype.grade = function( mood )
{
   return gradeAll( this.frames, mood );
};

BlinkSession.prototype.summary = function()
{
   let lights = this.lights();
   let keep = 0, review = 0, reject = 0, unread = 0, seconds = 0;
   for ( let i = 0; i < lights.length; ++i )
   {
      let v = effectiveVerdict( lights[ i ] );
      if ( v == "keep" )
         keep++;
      else if ( v == "review" )
         review++;
      else if ( v == "reject" )
         reject++;
      else
         unread++;
      if ( v == "keep" && isFinite( lights[ i ].exposure ) )
         seconds += lights[ i ].exposure;
   }
   let calib = 0;
   for ( let i = 0; i < this.frames.length; ++i )
      if ( this.frames[ i ].kind == "dark" || this.frames[ i ].kind == "flat" || this.frames[ i ].kind == "bias" || this.frames[ i ].kind == "darkflat" )
         calib++;
   return {
      lights: lights.length,
      keep: keep,
      review: review,
      reject: reject,
      unread: unread,
      hours: seconds / 3600,
      calibration: calib,
      other: this.frames.length - lights.length
   };
};

BlinkSession.prototype.filesForWBPP = function( includeReview )
{
   let files = [];
   for ( let i = 0; i < this.frames.length; ++i )
   {
      let f = this.frames[ i ];
      if ( f.kind == "dark" || f.kind == "flat" || f.kind == "bias" || f.kind == "darkflat" )
      {
         files.push( f.path );
         continue;
      }
      if ( f.kind != "light" )
         continue;
      let v = effectiveVerdict( f );
      if ( v == "keep" || ( includeReview && v == "review" ) )
         files.push( f.path );
   }
   return files;
};

BlinkSession.prototype.uniqueDestination = function( dest )
{
   if ( !File.exists( dest ) )
      return dest;
   let dir = File.extractDirectory( dest );
   let name = File.extractName( dest );
   let ext = File.extractExtension( dest );
   let stem = name.substring( 0, name.length - ext.length );
   for ( let n = 1; n < 1000; ++n )
   {
      let candidate = dir + "/" + stem + "_" + n + ext;
      if ( !File.exists( candidate ) )
         return candidate;
   }
   throw new Error( "Trop de copies pour " + dest );
};

BlinkSession.prototype.moveAside = function( frames )
{
   let moved = 0;
   for ( let i = 0; i < frames.length; ++i )
   {
      let frame = frames[ i ];
      if ( !frame || frame.kind != "light" )
         continue;
      if ( !File.exists( frame.path ) )
         continue;
      let dest = this.uniqueDestination( this.root + "/rejected/" + frame.rel );
      File.createDirectory( File.extractDirectory( dest ), true );
      File.move( frame.path, dest );
      this.moves.push( { from: frame.path, to: dest } );
      frame.path = dest;
      frame.rel = blinkRelative( this.root, dest );
      if ( frame.override != "keep" )
         frame.override = "reject";
      moved++;
   }
   this.saveManifest();
   return moved;
};

BlinkSession.prototype.restoreAll = function()
{
   let restored = 0;
   let left = [];
   for ( let i = 0; i < this.moves.length; ++i )
   {
      let move = this.moves[ i ];
      if ( !File.exists( move.to ) )
      {
         left.push( move );
         continue;
      }
      if ( File.exists( move.from ) )
      {
         left.push( move );
         continue;
      }
      File.createDirectory( File.extractDirectory( move.from ), true );
      File.move( move.to, move.from );
      for ( let j = 0; j < this.frames.length; ++j )
      {
         if ( this.frames[ j ].path == move.to )
         {
            this.frames[ j ].path = move.from;
            this.frames[ j ].rel = blinkRelative( this.root, move.from );
            if ( this.frames[ j ].override == "reject" )
               this.frames[ j ].override = null;
         }
      }
      restored++;
   }
   this.moves = left;
   this.saveManifest();
   return restored;
};

BlinkSession.prototype.deleteFiles = function( frames )
{
   let removed = 0;
   for ( let i = 0; i < frames.length; ++i )
   {
      let frame = frames[ i ];
      if ( !frame || !File.exists( frame.path ) )
         continue;
      File.remove( frame.path );
      frame.kind = "deleted";
      let still = [];
      for ( let j = 0; j < this.moves.length; ++j )
         if ( this.moves[ j ].to != frame.path && this.moves[ j ].from != frame.path )
            still.push( this.moves[ j ] );
      this.moves = still;
      removed++;
   }
   let alive = [];
   for ( let i = 0; i < this.frames.length; ++i )
      if ( this.frames[ i ].kind != "deleted" )
         alive.push( this.frames[ i ] );
   this.frames = alive;
   this.saveManifest();
   return removed;
};

function blinkCsvCell( value )
{
   if ( value == null || ( typeof value == "number" && !isFinite( value ) ) )
      return "";
   let s = String( value );
   if ( /[",\n\r]/.test( s ) )
      return "\"" + s.replace( /"/g, "\"\"" ) + "\"";
   return s;
}

BlinkSession.prototype.csvText = function()
{
   let headers = [ "chemin", "type", "cohorte", "verdict", "marque", "note", "motif", "etoiles", "fwhm", "excentricite", "fond", "bruit", "flux_etoile", "pose_s", "filtre", "nuit", "instrument", "cible" ];
   let lines = [ headers.join( "," ) ];
   for ( let i = 0; i < this.frames.length; ++i )
   {
      let f = this.frames[ i ];
      let m = f.measure || {};
      let cells = [
         f.path, f.kind, f.cohort || "", effectiveVerdict( f ), f.override || "",
         f.score, f.autoReason || "", m.stars, m.fwhm, m.eccentricity, m.median, m.noise, m.mstar,
         f.exposure, f.filter, f.night, f.instrument, f.object
      ];
      lines.push( cells.map( blinkCsvCell ).join( "," ) );
   }
   return lines.join( "\n" ) + "\n";
};

function blinkLaunchWBPP( filePaths, outputDirectory )
{
   let bppDir = CoreApplication.baseDirPath + "/src/scripts/BatchPreprocessing";
   if ( !File.exists( bppDir + "/WBPP.js" ) )
      throw new Error( "WeightedBatchPreprocessing est introuvable dans cette installation." );
   let source = wbppLauncherSource( {
      bppDir: bppDir,
      outputDirectory: outputDirectory,
      files: filePaths
   } );
   let scriptPath = File.systemTempDirectory + "/BlinkCull-open-wbpp.js";
   File.writeTextFile( scriptPath, source );

   let launcher = CoreApplication.filePath;
   if ( CoreApplication.platform == "Linux" || CoreApplication.platform == "FreeBSD" )
   {
      let sh = CoreApplication.baseDirPath + "/bin/PixInsight.sh";
      if ( File.exists( sh ) )
         launcher = sh;
   }
   let args = [ "-n", "--no-startup-scripts", "-r=" + scriptPath ];
   let process = new ExternalProcess;
   process.start( launcher, args );
   return scriptPath;
}
